"""Actual protected CLI + pinned Wrangler over a synthetic loopback D1 only."""
from pathlib import Path
import importlib.util
import json
import os
import pty
import re
import select
import shutil
import subprocess
import tempfile
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('bundle', ROOT / 'tools/build_vehicle_inventory_bundle.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def scenario(name, cutoff=18, action='read'):
    with tempfile.TemporaryDirectory(prefix='vehicle-inventory-test-') as temporary:
        base = Path(temporary)
        archive = base / 'bundle.zip'
        builder.build_bundle(lambda name: (ROOT / name).read_bytes(), 'a' * 40, 'b' * 40, archive)
        with zipfile.ZipFile(archive) as z:
            assert z.testzip() is None
            z.extractall(base)
        folder = base / 'vehicle-inventory-readonly'
        (folder / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
        shutil.copytree(ROOT / 'migrations', folder / 'fixture-migrations')
        shutil.copyfile(ROOT / 'tests/helpers/vehicleInventoryFixture.mjs', folder / 'fixture.mjs')
        config = dict(name='uber-v3-staging', account_id='a' * 32, d1_databases=[dict(binding='DB', database_name='transfer-servis52-staging', database_id='66474481-a123-47f9-81b4-12af7565ec8d')])
        if name == 'wrong_target':
            config['d1_databases'][0]['database_id'] = 'production'
        if name != 'init_new':
            (folder / 'wrangler.vehicle-inventory.staging.json').write_text(json.dumps(config))
        if name == 'tampered_query':
            (folder / 'docs/proposals/vehicle-inventory-readonly/legacy.sql').write_text('SELECT CONFIDENTIAL_VALUE;')
        env = os.environ.copy()
        env.pop('CI', None)
        env.pop('GITHUB_ACTIONS', None)
        env['INVENTORY_FIXTURE_CASE'] = name
        env['INVENTORY_FIXTURE_CUTOFF'] = str(cutoff)
        if name == 'endpoint_override':
            env['CLOUDFLARE_API_BASE_URL'] = 'http://CONFIDENTIAL_WRONG_ENDPOINT'
        master, slave = pty.openpty()
        process = subprocess.Popen(['node', '--import', str(folder / 'fixture.mjs'), 'scripts/vehicleInventoryRead.mjs', action], cwd=folder, env=env, stdin=slave, stdout=slave, stderr=slave, close_fds=True)
        os.close(slave)
        output, confirmed, account = b'', False, False
        try:
            deadline = time.monotonic() + 70
            while time.monotonic() < deadline:
                if select.select([master], [], [], 0.1)[0]:
                    try:
                        chunk = os.read(master, 65536)
                    except OSError:
                        break
                    if not chunk:
                        break
                    output += chunk
                    if b'Cloudflare Account ID' in output and not account:
                        os.write(master, b'a' * 32 + b'\n')
                        account = True
                    if b'Type exactly "READ STAGING VEHICLE METRICS"' in output and not confirmed:
                        os.write(master, b'CANCEL\n' if name == 'declined' else b'READ STAGING VEHICLE METRICS\n')
                        confirmed = True
                if process.poll() is not None:
                    break
            try:
                # PTY EOF can precede waitpid reporting the child's exit. Keep
                # the original deadline; do not mislabel that race as timeout.
                code = process.wait(timeout=max(0.001, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                process.kill()
                raise AssertionError(name + ': timeout; raw terminal output withheld')
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            os.close(master)
        state_path = folder / 'fixture-result.json'
        assert state_path.exists(), name + ': fixture failed before finalization; raw terminal output withheld'
        state = json.loads(state_path.read_text())
        assert state['writeRequests'] == 0 and state['realCloudflareRequests'] == 0, name
        assert b'CONFIDENTIAL_' not in output and str(folder).encode() not in output, name + ': private value was printed'
        receipts = list((folder / 'private-home').rglob('receipt.public.json'))
        success = name in ['success', 'orphans', 'init_new', 'init_existing']
        phase = re.search(rb'VEHICLE INVENTORY FAILED at ([a-z_]+)\.', output)
        diagnostic = dict(state, phase=phase[1].decode() if phase else 'unavailable')
        assert code == (0 if success else 1), name + ': unexpected CLI result ' + json.dumps(diagnostic) + '; raw terminal output withheld'
        if action == 'init':
            assert state['requests'] == 0 and not receipts
            assert json.loads((folder / 'wrangler.vehicle-inventory.staging.json').read_text()) == config
            assert account == (name == 'init_new')
        elif success:
            assert confirmed and state['metricRequests'] == 1 and state['metadataRequests'] == 2 and state['badRequests'] == 0, name
            assert len(receipts) == 1
            public = json.loads(receipts[0].read_text())
            private = json.loads(receipts[0].with_name('metrics.private.json').read_text())
            allowed = {'formatVersion','scope','sourceCommit','sourceTree','worker','databaseName','databaseId','profile','querySha256','startedAtUtc','completedAtUtc','activationAuthorized','admissionEvaluated','remoteWritesPerformed','result','sourceFilesVerified','schemaStable','aggregateFormatVerified','privateReportWritten'}
            assert set(public) == allowed and public['result'] == 'success'
            assert not public['activationAuthorized'] and not public['admissionEvaluated'] and not public['remoteWritesPerformed']
            assert len(private['metrics']) == 18 and private['schemaFingerprint']
            assert receipts[0].stat().st_mode & 0o777 == 0o600
            if name == 'orphans':
                assert private['metrics']['vehicles'] == 0 and private['metrics']['online_without_matching_candidate'] == 1 and private['metrics']['active_assignments_without_matching_candidate'] == 1
        else:
            assert not receipts and not list((folder / 'private-home').rglob('metrics.private.json')), name + ': failed read left accepted output'
            if name in ['wrong_target','tampered_query','endpoint_override']:
                assert state['requests'] == 0
            if name in ['newer_chain','unknown_column','declined','auth_error','folder_error']:
                assert state['metricRequests'] == 0
            if name in ['extra_column','wrong_counter','schema_changed','timeout','malformed']:
                assert state['metricRequests'] == 1
        return {'scenario': name, 'schemaCutoff': cutoff, 'result': 'PASS'}


if __name__ == '__main__':
    outcomes = [scenario('success', c) for c in [18, 20, 22, 23, 25]]
    outcomes += [scenario(n) for n in ['orphans','wrong_target','tampered_query','endpoint_override','newer_chain','unknown_column','declined','auth_error','folder_error','extra_column','wrong_counter','schema_changed','timeout','malformed']]
    outcomes += [scenario('init_new', action='init'), scenario('init_existing', action='init')]
    print(json.dumps({'engine': 'actual protected CLI + Wrangler 4.125.0 + synthetic loopback D1', 'scenarios': outcomes, 'realCloudflareRequests': 0, 'rawTerminalOutputDisclosed': False}))

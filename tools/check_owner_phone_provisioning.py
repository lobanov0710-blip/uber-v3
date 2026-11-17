"""Linux PTY regression: actual CLI, actual Wrangler, synthetic loopback D1 API."""
from pathlib import Path
import hashlib
import json
import os
import pty
import re
import select
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def scenario(name, legacy=False, newer_chain=False):
    with tempfile.TemporaryDirectory(prefix='owner-provision-fixture-') as temporary:
        folder = Path(temporary)
        for directory in ('src', 'scripts', 'migrations'):
            shutil.copytree(ROOT / directory, folder / directory)
        # This protected setup is approved only for the original 18-migration
        # OWNER phone target. Model that exact deployment in its positive cases;
        # independently require the unmodified CLI to reject a newer chain.
        migration_files = list((folder / 'migrations').glob('*.sql'))
        if newer_chain:
            assert any(int(p.name[:4]) > 18 for p in migration_files), 'newer-chain fixture absent'
        else:
            for migration in migration_files:
                if int(migration.name[:4]) > 18:
                    migration.unlink()
            assert len(list((folder / 'migrations').glob('*.sql'))) == 18
        for filename in ('package.json', 'package-lock.json'):
            shutil.copy2(ROOT / filename, folder / filename)
        (folder / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
        main = folder / 'scripts/adminOwnerPhoneSetup.mjs'
        if legacy:
            old = "await client.run(['d1','execute','DB','--remote','--file',file,'--yes','--json']);"
            assert main.read_text().count(old) == 1, 'legacy control patch target absent'
            main.write_text(main.read_text().replace(old, old[:-2] + ',{json:true});'))
        protected = [p for directory in ('src', 'scripts', 'migrations') for p in (folder / directory).rglob('*') if p.is_file()]
        protected += [folder / 'package.json', folder / 'package-lock.json']
        (folder / 'owner-phone-release.json').write_text(json.dumps({'sourceCommit': 'a' * 40, 'files': {str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest() for p in protected}}))
        (folder / 'fixture.mjs').write_bytes((ROOT / 'tests/helpers/ownerPhoneProvisioningFixture.mjs').read_bytes())
        config = {'name': 'uber-v3-staging', 'account_id': 'a' * 32, 'main': 'src/index.js', 'compatibility_date': '2026-06-01', 'workers_dev': True,
                  'vars': {'APP_ENV': 'staging', 'ADMIN_PHONE_TEST_ONLY': 'true'}, 'triggers': {'crons': ['0 * * * *']},
                  'kv_namespaces': [{'binding': 'DRIVERS', 'id': 'b8fdeb74fda8415ab06b3b1c86c78e8f'}],
                  'd1_databases': [{'binding': 'DB', 'database_name': 'transfer-servis52-staging', 'database_id': '66474481-a123-47f9-81b4-12af7565ec8d', 'migrations_dir': 'migrations'}]}
        (folder / 'wrangler.admin-phone.staging.json').write_text(json.dumps(config))
        environment = os.environ.copy()
        environment.pop('CI', None)
        environment['OWNER_FIXTURE_SCENARIO'] = name
        master, slave = pty.openpty()
        process = subprocess.Popen(['node', '--import', str(folder / 'fixture.mjs'), 'scripts/adminOwnerPhoneSetup.mjs', 'owner'], cwd=folder, stdin=slave, stdout=slave, stderr=slave, env=environment, close_fds=True)
        os.close(slave)
        output, sent, confirmed = b'', set(), False
        prompts = [(b'Create a new OWNER account (N)', b'n'), (b'New OWNER login:', b'owner.fixture'),
                   (b'Display name:', b'Synthetic OWNER'), (b'New password (', b'Synthetic-Owner-Password-123!'),
                   (b'Repeat password (', b'Synthetic-Owner-Password-123!')]
        try:
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                if select.select([master], [], [], 0.2)[0]:
                    try:
                        data = os.read(master, 16384)
                    except OSError:
                        break
                    if not data:
                        break
                    output += data
                    for index, (prompt, answer) in enumerate(prompts):
                        if index not in sent and prompt in output:
                            os.write(master, answer + b'\n')
                            sent.add(index)
                    match = re.search(rb'Type exactly "(PROVISION STAGING OWNER [^"\r\n]+)" to continue:', output)
                    if match and not confirmed:
                        os.write(master, match[1] + b'\n')
                        confirmed = True
                if process.poll() is not None:
                    break
            if process.poll() is None:
                process.kill()
                raise AssertionError(name + ': fixture timed out; no terminal output disclosed')
            code = process.wait(timeout=5)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            os.close(master)
        state_path = folder / 'fixture-result.json'
        assert state_path.exists(), name + ': fixture did not finalize; no terminal output disclosed'
        state = json.loads(state_path.read_text())
        if newer_chain:
            assert code == 1 and not confirmed and not sent, 'newer schema must stop before provisioning prompts'
            assert state == {'accounts': 0, 'owners': 0, 'factors': 0, 'bootstrap': 0, 'audits': 0,
                             'importRequests': 0, 'uploads': 0, 'verifyReads': 0}, 'newer chain performed a write'
            assert b'FAILED at owner' in output and not re.search(rb'bootstrap_[A-Za-z0-9_-]{43}', output)
            return {'scenario': 'newer_migration_chain_rejected', 'result': 'PASS'}
        assert confirmed and state['importRequests'] == 1, name + ': expected one confirmed import ' + json.dumps({'confirmed': confirmed, 'answeredPrompts': sorted(sent), 'state': state, 'failedAtOwner': b'FAILED at owner' in output, 'readingTarget': b'Reading the exact STAGING target' in output})
        assert b'Synthetic-Owner-Password-123!' not in output, name + ': hidden password was echoed'
        shown = bool(re.search(rb'bootstrap_[A-Za-z0-9_-]{43}', output))
        if legacy:
            assert code == 1 and not shown and state['owners'] == 1 and state['bootstrap'] == 1 and state['verifyReads'] == 0, 'legacy post-commit JSON failure not reproduced'
        elif name in ('new_success', 'existing_success'):
            assert code == 0 and shown and state['accounts'] == 1 and state['owners'] == 1 and state['bootstrap'] == 1 and state['audits'] == 1 and state['factors'] == 0 and state['verifyReads'] == 1, name + ': successful verified setup not reached'
        elif name == 'wrong_postcondition':
            assert code == 1 and not shown and state['bootstrap'] == 1 and state['verifyReads'] == 1, 'unverified bootstrap disclosed'
        else:
            assert code == 1 and not shown and state['bootstrap'] == 0 and state['audits'] == 0 and state['verifyReads'] == 0, 'failed import did not roll back'
        return {'scenario': 'legacy_committed_failure' if legacy else name, 'result': 'PASS'}


results = [scenario('new_success', legacy=True)]
results += [scenario(name) for name in ('new_success', 'existing_success', 'wrong_postcondition', 'import_failure')]
results += [scenario('new_success', newer_chain=True)]
print(json.dumps({'engine': 'actual protected CLI + Wrangler 4.125.0 + synthetic loopback SQLite/D1 API', 'scenarios': results, 'realCloudflareRequests': 0, 'rawTerminalOutputDisclosed': False}))

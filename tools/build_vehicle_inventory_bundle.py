"""Build the credential-free owner bundle from a clean, pinned Git commit."""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = ['scripts/vehicleInventoryRead.mjs', 'scripts/lib/ownerTerminal.mjs',
         'scripts/lib/vehicleInventoryPolicy.mjs', 'scripts/lib/vehicleInventoryWrangler.mjs',
         'scripts/lib/vehicleInventoryFiles.mjs', 'scripts/vehicle-inventory-schema.json',
         'docs/VEHICLE_LEGACY_INVENTORY_READ_PLAN_2026-11-19.json']
FILES += ['docs/proposals/vehicle-inventory-readonly/' + n + '.sql'
          for n in ['legacy', 'registration', 'bindings', 'trusted', 'holds']]


def build_bundle(read, source_commit, source_tree, output):
    files = {name: read(name) for name in FILES}
    original = json.loads(read('package.json'))
    package = {k: original[k] for k in ['type', 'engines', 'packageManager', 'overrides']}
    package.update(name='transfer-driver-vehicle-inventory', version='1.0.0', private=True,
                   devDependencies={'wrangler': '4.125.0'})
    lock = json.loads(read('package-lock.json'))
    assert lock['packages']['node_modules/wrangler']['version'] == '4.125.0'
    lock.update(name=package['name'], version=package['version'])
    lock['packages'][''].update(name=package['name'], version=package['version'],
                               devDependencies=package['devDependencies'])
    for name, value in [('package.json', package), ('package-lock.json', lock)]:
        files[name] = (json.dumps(value, indent=2) + '\n').encode()
    files['README-WINDOWS.md'] = read('docs/VEHICLE_INVENTORY_WINDOWS.md')
    hashes = {name: hashlib.sha256(data).hexdigest() for name, data in sorted(files.items())}
    release = dict(formatVersion=1, sourceCommit=source_commit, sourceTree=source_tree, files=hashes)
    files['vehicle-inventory-release.json'] = (json.dumps(release, indent=2) + '\n').encode()
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo('vehicle-inventory-readonly/' + name, (2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)
    return release


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    def git(*values):
        return subprocess.check_output(['git', *values], cwd=ROOT)
    assert not git('status', '--porcelain').strip(), 'Clean source required'
    source = git('rev-parse', 'HEAD').decode().strip()
    tree = git('rev-parse', 'HEAD^{tree}').decode().strip()
    build_bundle(lambda name: git('show', source + ':' + name), source, tree, args.output)
    print('VEHICLE_INVENTORY_BUNDLE=PASS source=' + source + ' sha256=' + hashlib.sha256(args.output.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()

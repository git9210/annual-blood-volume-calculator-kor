#!/usr/bin/env python3
"""Verify the version, APK assets and exact public source snapshot before publishing."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import zipfile
import xml.etree.ElementTree as ET


def public_source_files(root):
    files = []
    for folder in ('assets', 'res', 'src', 'tools', 'tests'):
        files.extend(p for p in (root / folder).rglob('*') if p.is_file()
                     and '__pycache__' not in p.parts and p.suffix not in {'.pyc', '.class'})
    files.extend(p for p in root.iterdir() if p.is_file() and
                 (p.suffix == '.md' or p.name in {'.gitignore', 'AndroidManifest.xml',
                                                'build.py', 'build-info.json', 'package.json'}))
    return sorted(set(files))


def verify(root, apk, source_zip):
    android = '{http://schemas.android.com/apk/res/android}'
    manifest = ET.parse(root / 'AndroidManifest.xml').getroot()
    version = manifest.get(android + 'versionName')
    code = int(manifest.get(android + 'versionCode'))
    info = json.loads((root / 'build-info.json').read_text())
    assert re.fullmatch(r'\d+\.\d+\.\d+', version), 'Invalid version'
    assert manifest.get('package') == info['package'] == 'kr.bloodnote.app'
    assert (info['version'], info['version_code'], info['release_tag']) == (version, code, 'v' + version)
    assert apk.name == info['apk'] == f'Annual-Blood-Volume-Calculator-{version}-Small.apk'
    assert source_zip.name == f'Annual-Blood-Volume-Calculator-{version}-GitHub-Source.zip'
    apk_bytes = apk.read_bytes()
    assert len(apk_bytes) == info['bytes'] and hashlib.sha256(apk_bytes).hexdigest() == info['sha256']
    app = (root / 'assets/app.mjs').read_text()
    assert f'현재 v{version} · GitHub 정식 배포판' in app and f'안드로이드 {version}' in app
    assert (root / 'README.md').read_text().startswith(f'# 헌혈 계산기 {version}\n')
    assert f'## 현재 v{version}의 기능' in (root / 'VERSION-HISTORY.md').read_text()
    with zipfile.ZipFile(apk) as archive:
        assert archive.testzip() is None and len(archive.namelist()) == len(set(archive.namelist()))
        assets = {str(p.relative_to(root)): p.read_bytes() for p in (root / 'assets').rglob('*') if p.is_file()}
        assert {n: archive.read(n) for n in archive.namelist() if n.startswith('assets/')} == assets
    files = {str(p.relative_to(root)): p.read_bytes() for p in public_source_files(root)}
    with zipfile.ZipFile(source_zip) as archive:
        assert archive.testzip() is None and len(archive.namelist()) == len(set(archive.namelist()))
        prefix = 'annual-blood-volume-calculator/'
        assert all(n.startswith(prefix) and not n.endswith('/') for n in archive.namelist())
        actual = {n[len(prefix):]: archive.read(n) for n in archive.namelist()}
        assert actual == files, 'Source ZIP differs from the repository source snapshot'
        for name, data in actual.items():
            path = PurePosixPath(name)
            assert not path.is_absolute() and '..' not in path.parts
            assert not any(part in {'signing', '.git', 'build', 'dist', '__pycache__'} for part in path.parts)
            assert path.suffix.lower() not in {'.jks', '.keystore', '.p12', '.pfx', '.apk', '.pdf', '.pyc', '.class', '.dex'}
            assert path.name != 'password.txt'
            assert not re.search(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', data)
    return {'version': version, 'version_code': code, 'release_tag': 'v' + version,
            'apk_sha256': info['sha256'], 'public_source_files': len(files),
            'source_zip_sha256': hashlib.sha256(source_zip.read_bytes()).hexdigest(),
            'source_snapshot_matches': True, 'apk_assets_match': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--apk', type=Path, required=True)
    parser.add_argument('--source-zip', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(verify(args.root.resolve(), args.apk.resolve(), args.source_zip.resolve()), indent=2))

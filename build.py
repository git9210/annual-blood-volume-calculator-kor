#!/usr/bin/env python3
"""Dependency-free Android build. Needs JDK 17+, SDK platform/build-tools 36."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent
SDK = Path(os.environ.get('ANDROID_HOME', ROOT.parent / 'android-tools'))
TOOLS = SDK / 'build-tools' / '36.0.0'
if not TOOLS.exists():
    TOOLS = SDK / 'build-tools' / 'android-16'
PLATFORM = SDK / 'platforms' / 'android-36' / 'android.jar'
if not PLATFORM.exists():
    PLATFORM = SDK / 'platform' / 'android-36' / 'android.jar'
BUILD = ROOT / 'build'
SIGNING = ROOT / 'signing'
MANIFEST = ET.parse(ROOT / 'AndroidManifest.xml').getroot()
ANDROID = '{http://schemas.android.com/apk/res/android}'
VERSION = MANIFEST.attrib[ANDROID + 'versionName']
VERSION_CODE = int(MANIFEST.attrib[ANDROID + 'versionCode'])
OUTPUT = ROOT.parent / f'Annual-Blood-Volume-Calculator-{VERSION}-Small.apk'

def run(*args):
    subprocess.run([str(x) for x in args], cwd=ROOT, check=True)

def main():
    if not PLATFORM.is_file() or not (TOOLS / 'aapt2').is_file():
        raise SystemExit('Install Android SDK platform 36 and build-tools 36.0.0; set ANDROID_HOME.')
    if BUILD.exists():
        shutil.rmtree(BUILD)
    for name in ('gen', 'classes', 'dex'):
        (BUILD / name).mkdir(parents=True, exist_ok=True)
    SIGNING.mkdir(exist_ok=True, mode=0o700)
    key, password = SIGNING / 'release.jks', SIGNING / 'password.txt'
    if not key.exists():
        password.write_text(secrets.token_urlsafe(36), encoding='ascii')
        password.chmod(0o600)
        # File-based password arguments keep credentials out of command output.
        run('keytool', '-genkeypair', '-keystore', key, '-storetype', 'PKCS12',
            '-storepass:file', password, '-keypass:file', password, '-alias', 'blood-note',
            '-keyalg', 'RSA', '-keysize', '3072', '-validity', '36500',
            '-dname', 'CN=Blood Note, O=Personal Application, C=KR')
        key.chmod(0o600)
    elif not password.exists():
        raise SystemExit('Signing password is missing. Restore it; do not create a different key for updates.')
    run(TOOLS / 'aapt2', 'compile', '--dir', ROOT / 'res', '-o', BUILD / 'resources.zip')
    run(TOOLS / 'aapt2', 'link', '-o', BUILD / 'base.apk', '-I', PLATFORM,
        '--manifest', ROOT / 'AndroidManifest.xml', '--java', BUILD / 'gen',
        '-A', ROOT / 'assets', '--auto-add-overlay', BUILD / 'resources.zip')
    sources = sorted((ROOT / 'src').rglob('*.java')) + sorted((BUILD / 'gen').rglob('*.java'))
    run('java', '-m', 'jdk.compiler/com.sun.tools.javac.Main', '-encoding', 'UTF-8',
        '-source', '8', '-target', '8', '-bootclasspath', str(TOOLS / 'core-lambda-stubs.jar') + os.pathsep + str(PLATFORM),
        '-d', BUILD / 'classes', *sources)
    # Check the compiled Android routing policy against the APK's real web files.
    # JS-only tests cannot catch a module blocked by the native request interceptor.
    run('python3', ROOT / 'tools/verify_web_assets.py', BUILD / 'classes', PLATFORM, BUILD / 'base.apk')
    with zipfile.ZipFile(BUILD / 'classes.jar', 'w', zipfile.ZIP_DEFLATED) as jar:
        for path in sorted((BUILD / 'classes').rglob('*.class')):
            jar.write(path, path.relative_to(BUILD / 'classes'))
    run('java', '-cp', TOOLS / 'lib/d8.jar', 'com.android.tools.r8.D8',
        '--release', '--min-api', '26', '--lib', PLATFORM,
        '--output', BUILD / 'dex', BUILD / 'classes.jar')
    unsigned = BUILD / 'unsigned.apk'
    shutil.copy2(BUILD / 'base.apk', unsigned)
    with zipfile.ZipFile(unsigned, 'a', zipfile.ZIP_DEFLATED) as apk:
        for dex in sorted((BUILD / 'dex').glob('*.dex')):
            apk.write(dex, dex.name)
    run(TOOLS / 'zipalign', '-P', '16', '-f', '4', unsigned, BUILD / 'aligned.apk')
    run('java', '-jar', TOOLS / 'lib/apksigner.jar', 'sign', '--ks', key,
        '--ks-key-alias', 'blood-note', '--ks-pass', 'file:' + str(password),
        '--out', OUTPUT, BUILD / 'aligned.apk')
    run('java', '-jar', TOOLS / 'lib/apksigner.jar', 'verify', '--verbose', OUTPUT)
    run(TOOLS / 'zipalign', '-c', '-P', '16', '4', OUTPUT)
    info = {'apk': OUTPUT.name, 'package': 'kr.bloodnote.app', 'version': VERSION, 'version_code': VERSION_CODE,
        'bytes': OUTPUT.stat().st_size, 'sha256': hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),
        'source_site_commit': '50610ab9f40c6b27c841547ad5bba16693c49f19',
        'min_sdk': 26, 'target_sdk': 36, 'device_tested': False}
    (ROOT / 'build-info.json').write_text(json.dumps(info, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(info, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()

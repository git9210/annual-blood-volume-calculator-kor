"""Check packaged web files against the compiled Android routing policy, offline.

This intentionally does not replace imports with test doubles. The same ASSETS
set and mime() method used by MainActivity's request interceptor are read from
the compiled class, and checked against the actual APK bundle before signing.
No Activity, browser, network, or user-data store is opened.
"""
from html.parser import HTMLParser
from pathlib import Path
import os
import re
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urljoin, urlsplit
import zipfile

ORIGIN = "https://appassets.androidplatform.net"
MIMES = {".html": "text/html", ".mjs": "text/javascript", ".css": "text/css",
         ".svg": "image/svg+xml", ".txt": "text/plain", ".png": "image/png"}
IMPORTS = re.compile(
    r'''^\s*(?:import\s+(?:[^;]*?\bfrom\s*)?|export\s+(?:\*|\{[^}]*\})\s+from\s*)["']([^"']+)["']''',
    re.MULTILINE)


class DocumentResources(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("src"):
            self.references.append(attrs["src"])
        if tag == "link" and attrs.get("href") and set(attrs.get("rel", "").split()) & {"stylesheet", "icon"}:
            self.references.append(attrs["href"])


def compiled_policy(classes, platform):
    with tempfile.TemporaryDirectory(prefix="blood-note-web-policy-") as directory:
        probe = Path(__file__).with_name("WebAssetPolicyProbe.java")
        subprocess.run(["java", "-m", "jdk.compiler/com.sun.tools.javac.Main", "-encoding", "UTF-8",
                        "-d", directory, str(probe)], check=True, capture_output=True)
        classpath = os.pathsep.join(map(str, [directory, classes, platform]))
        result = subprocess.run(["java", "-cp", classpath, "WebAssetPolicyProbe"],
                                check=True, capture_output=True, text=True)
    return dict(line.split("\t", 1) for line in result.stdout.splitlines())


def verify_bundle(apk, policy):
    errors = []
    with zipfile.ZipFile(apk) as bundle:
        assets = {name[len("assets/"):]: bundle.read(name) for name in bundle.namelist()
                  if name.startswith("assets/") and not name.endswith("/")}
    for name, data in assets.items():
        expected = MIMES.get(Path(name).suffix)
        if name not in policy:
            errors.append("Android blocks packaged file: " + name)
        elif expected is None or policy[name] != expected:
            errors.append("Unexpected MIME type for " + name + ": " + policy[name])
    for name in policy:
        if name not in assets:
            errors.append("Allowed file missing from APK: " + name)
    if "index.html" not in assets:
        errors.append("Missing startup document: index.html")
    references = []
    for name, data in assets.items():
        if name.endswith(".html"):
            document = DocumentResources()
            document.feed(data.decode("utf-8"))
            references.extend((name, ref) for ref in document.references)
        elif name.endswith(".mjs"):
            references.extend((name, ref) for ref in IMPORTS.findall(data.decode("utf-8")))
        elif name.endswith(".css"):
            references.extend((name, ref) for ref in re.findall(r'''url\(\s*["']?([^\s)"']+)["']?\s*\)''', data.decode("utf-8")))
    for source, reference in references:
        if reference.startswith("data:"):
            continue
        url = urlsplit(urljoin(ORIGIN + "/assets/" + source, reference))
        if url.scheme != "https" or url.netloc != "appassets.androidplatform.net" or not url.path.startswith("/assets/"):
            errors.append("Non-local web dependency: " + source + " -> " + reference)
            continue
        target = unquote(url.path[len("/assets/"):])
        if target not in assets or target not in policy:
            errors.append("Unloadable web dependency: " + source + " -> " + reference)
    if errors:
        raise ValueError("\n".join(sorted(set(errors))))
    return len(assets), len(references)


def main():
    if len(sys.argv) != 4:
        raise SystemExit("Usage: verify_web_assets.py COMPILED_CLASSES ANDROID_JAR APK")
    try:
        classes, platform, apk = map(Path, sys.argv[1:])
        count, references = verify_bundle(apk, compiled_policy(classes, platform))
    except (ValueError, OSError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        raise SystemExit("Web asset verification failed:\n" + str(error))
    print(f"PASS: {count} packaged web files and {references} resource references match the compiled Android allowlist and MIME policy (offline).")


if __name__ == "__main__":
    main()

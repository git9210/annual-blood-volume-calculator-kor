"""Run pure Java regression checks; no Android runtime, network, or extra packages."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
names = ["CertificateParser", "HolidayAccess", "VaultCrypto", "UpdatePolicy"]
with tempfile.TemporaryDirectory(prefix="blood-volume-tests-") as output:
    files = [root / "src/kr/bloodnote/app" / (name + ".java") for name in names]
    files += [root / "tests" / (name + "Test.java") for name in names]
    subprocess.run(["java", "-m", "jdk.compiler/com.sun.tools.javac.Main", "-encoding", "UTF-8", "-d", output, *map(str, files)], check=True)
    for name in names:
        subprocess.run(["java", "-cp", output, "kr.bloodnote.app." + name + "Test"], check=True)

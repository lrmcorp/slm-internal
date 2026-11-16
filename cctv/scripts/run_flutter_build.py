"""Container entry point for an Android debug APK, including managed network trust."""

import os
import subprocess
from urllib.parse import urlsplit

api = os.environ.get("API_BASE_URL", "")
if not api.startswith("https://") and not api.startswith("http://10.0.2.2:"):
    raise SystemExit("API_BASE_URL must be an HTTPS URL (or local Android emulator URL)")

java_options = ["-Djavax.net.ssl.trustStore=/tmp/host-cacerts"]
proxy = urlsplit(os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy") or "")
if proxy.hostname:
    java_options.extend([
        f"-Dhttps.proxyHost={proxy.hostname}", f"-Dhttps.proxyPort={proxy.port or 80}",
        f"-Dhttp.proxyHost={proxy.hostname}", f"-Dhttp.proxyPort={proxy.port or 80}",
        "-Dhttp.nonProxyHosts=localhost|127.*",
    ])
os.environ["JAVA_TOOL_OPTIONS"] = " ".join(java_options)

subprocess.run(["flutter", "pub", "get"], check=True)
subprocess.run(["flutter", "analyze", "--no-pub"], check=True)
command = ["flutter", "build", "apk", "--debug", "--no-pub", f"--dart-define=API_BASE_URL={api}"]
for name in ("FIREBASE_API_KEY", "FIREBASE_APP_ID", "FIREBASE_PROJECT_ID", "FIREBASE_SENDER_ID"):
    if os.environ.get(name):
        command.append(f"--dart-define={name}={os.environ[name]}")
subprocess.run(command, check=True)

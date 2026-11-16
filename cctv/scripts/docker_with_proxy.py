"""Use the managed proxy's resolved IP inside Docker's isolated DNS namespace."""

import os
import socket
import subprocess
import sys
from urllib.parse import urlsplit, urlunsplit

if len(sys.argv) < 2:
    raise SystemExit("Usage: docker_with_proxy.py COMMAND [ARGS...]")

environment = os.environ.copy()
for name in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
    value = environment.get(name)
    if not value:
        continue
    parsed = urlsplit(value)
    if parsed.hostname:
        try:
            address = socket.gethostbyname(parsed.hostname)
        except OSError:
            continue
        environment[name] = urlunsplit((parsed.scheme,
            parsed.netloc.replace(parsed.hostname, address, 1), parsed.path, parsed.query, parsed.fragment))

raise SystemExit(subprocess.run(sys.argv[1:], env=environment).returncode)

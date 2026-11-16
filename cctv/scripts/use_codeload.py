"""Replace GitHub API archive URLs with official codeload archives at the same commit."""

import json
from pathlib import Path

lock = Path(__file__).resolve().parents[1] / "backend" / "composer.lock"
data = json.loads(lock.read_text())
count = 0
for package in data["packages"] + data["packages-dev"]:
    dist = package.get("dist", {})
    url = dist.get("url", "")
    if url.startswith("https://api.github.com/repos/") and "/zipball/" in url:
        dist["url"] = url.replace("https://api.github.com/repos/", "https://codeload.github.com/").replace(
            "/zipball/", "/zip/"
        )
        count += 1
lock.write_text(json.dumps(data, indent=4, ensure_ascii=False) + "\n")
print(f"Rewrote {count} official GitHub archive URLs; commit references and checksums unchanged")

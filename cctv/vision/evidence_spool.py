"""Keep unsent incident evidence on disk until the ingest service accepts it."""

from pathlib import Path
import json
import shutil
import tempfile
import time
import uuid


class EvidenceSpool:
    def __init__(self, root: str):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.root.chmod(0o700)

    def save(self, event: dict, occurred_at: str, snapshot: bytes, clip: Path) -> Path:
        staging = Path(tempfile.mkdtemp(prefix=".partial-", dir=self.root))
        try:
            (staging / "snapshot.jpg").write_bytes(snapshot)
            shutil.copyfile(clip, staging / "event.mp4")
            (staging / "metadata.json").write_text(json.dumps({
                "event": event, "occurred_at": occurred_at,
            }), encoding="utf-8")
            destination = self.root / uuid.uuid4().hex
            staging.rename(destination)
            return destination
        except Exception:
            shutil.rmtree(staging, ignore_errors=True)
            raise

    def pending(self):
        return sorted(path for path in self.root.iterdir()
                      if path.is_dir() and not path.name.startswith(".")
                      and (path / "metadata.json").is_file())

    @staticmethod
    def remove(path: Path):
        shutil.rmtree(path)

    def prune(self, max_age: float, max_bytes: int):
        """Buang bukti yang terlalu tua, lalu yang tertua sampai total di bawah batas disk."""
        items = [(path.stat().st_mtime, path, sum(f.stat().st_size for f in path.rglob("*") if f.is_file()))
                 for path in self.pending()]
        total = sum(size for _, _, size in items)
        for mtime, path, size in sorted(items):
            if time.time() - mtime > max_age or total > max_bytes:
                shutil.rmtree(path, ignore_errors=True)
                total -= size

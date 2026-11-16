import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evidence_spool import EvidenceSpool


class EvidenceSpoolTest(unittest.TestCase):
    def test_evidence_survives_new_spool_instance_until_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            clip = Path(directory) / "source.mp4"
            clip.write_bytes(b"three-second-test-clip")
            spool = EvidenceSpool(str(Path(directory) / "spool"))
            item = spool.save({"source_event_id": "tracking-123", "item_count": 1},
                              "2026-10-07T00:00:00Z", b"snapshot", clip)
            restarted = EvidenceSpool(str(Path(directory) / "spool"))
            self.assertEqual([item], restarted.pending())
            self.assertEqual(b"snapshot", (item / "snapshot.jpg").read_bytes())
            self.assertEqual(clip.read_bytes(), (item / "event.mp4").read_bytes())
            restarted.remove(item)
            self.assertEqual([], restarted.pending())


class EvidenceSpoolPruneTest(unittest.TestCase):
    def test_prune_drops_old_items_and_enforces_size_cap(self):
        import os
        import time
        with tempfile.TemporaryDirectory() as directory:
            clip = Path(directory) / "source.mp4"
            clip.write_bytes(b"x" * 100)
            spool = EvidenceSpool(str(Path(directory) / "spool"))
            old = spool.save({"source_event_id": "old"}, "t", b"s", clip)
            os.utime(old, (time.time() - 7200, time.time() - 7200))
            first = spool.save({"source_event_id": "a"}, "t", b"s", clip)
            os.utime(first, (time.time() - 60, time.time() - 60))
            newest = spool.save({"source_event_id": "b"}, "t", b"s", clip)
            spool.prune(max_age=3600, max_bytes=10_000)
            self.assertEqual({first, newest}, set(spool.pending()))
            spool.prune(max_age=3600, max_bytes=200)  # muat satu item saja (±152 byte): yang tertua dibuang
            self.assertEqual([newest], spool.pending())

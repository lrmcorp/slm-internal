import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evidence_spool import EvidenceSpool

try:
    from worker import Worker
except ModuleNotFoundError:
    Worker = None


@unittest.skipIf(Worker is None, "Run in the vision container for OpenCV")
class WorkerEvidenceTest(unittest.TestCase):
    def test_saved_evidence_retries_with_same_event_id(self):
        with tempfile.TemporaryDirectory() as directory:
            spool = EvidenceSpool(str(Path(directory) / "1"))
            clip = Path(directory) / "event.mp4"
            clip.write_bytes(b"video")
            item = spool.save({"source_event_id": "tracking-123", "item_count": 1},
                              "2026-10-07T00:00:00Z", b"photo", clip)
            sent = []

            class Response:
                def raise_for_status(self):
                    return None

            def post(endpoint, **kwargs):
                sent.append((endpoint, kwargs["data"],
                             kwargs["files"]["snapshot"][1],
                             kwargs["files"]["clip"][1].read()))
                return Response()

            worker = Worker.__new__(Worker)
            worker.spool = spool
            worker.post_background = post
            worker.retry_spool()

            self.assertEqual([], spool.pending())
            self.assertFalse(item.exists())
            self.assertEqual("incidents", sent[0][0])
            self.assertEqual("tracking-123", sent[0][1]["source_event_id"])
            self.assertEqual(b"photo", sent[0][2])
            self.assertEqual(b"video", sent[0][3])


@unittest.skipIf(Worker is None, "Run in the vision container for OpenCV")
class SpoolRetryPolicyTest(unittest.TestCase):
    def make(self, directory, status):
        import requests
        spool = EvidenceSpool(str(Path(directory) / "1"))
        clip = Path(directory) / "event.mp4"
        clip.write_bytes(b"video")
        item = spool.save({"source_event_id": "e1", "item_count": 1}, "2026-10-07T00:00:00Z", b"photo", clip)
        calls = []

        def post(endpoint, **kwargs):
            calls.append(endpoint)
            if status is None:
                raise requests.ConnectionError()
            response = requests.Response()
            response.status_code = status
            response.raise_for_status()

        worker = Worker.__new__(Worker)
        worker.spool = spool
        worker.post_background = post
        return worker, spool, item, calls

    def test_permanent_rejection_is_dropped_not_retried_forever(self):
        with tempfile.TemporaryDirectory() as directory:
            worker, spool, item, calls = self.make(directory, 422)
            worker.retry_spool()
            self.assertEqual([], spool.pending())

    def test_server_error_is_kept_but_backed_off(self):
        with tempfile.TemporaryDirectory() as directory:
            worker, spool, item, calls = self.make(directory, 503)
            worker.retry_spool()
            worker.retry_spool()  # kedua: masih dalam masa tunggu, tidak boleh memanggil lagi
            self.assertEqual([item], spool.pending())
            self.assertEqual(1, len(calls))

    def test_unreachable_server_stops_the_round(self):
        with tempfile.TemporaryDirectory() as directory:
            worker, spool, item, calls = self.make(directory, None)
            clip = Path(directory) / "e2.mp4"
            clip.write_bytes(b"v")
            spool.save({"source_event_id": "e2", "item_count": 1}, "2026-10-07T00:00:01Z", b"p", clip)
            worker.retry_spool()
            self.assertEqual(1, len(calls))
            self.assertEqual(2, len(spool.pending()))


class GeminiBackoffTest(unittest.TestCase):
    @unittest.skipIf(Worker is None, "Run in the vision container for OpenCV")
    def test_failures_back_off_exponentially_and_success_resets(self):
        import worker
        worker.gemini_backoff(True, 1000.0)
        self.assertEqual(1030.0, worker._GEMINI_BLOCK_UNTIL)
        worker.gemini_backoff(True, 1000.0)
        self.assertEqual(1060.0, worker._GEMINI_BLOCK_UNTIL)
        for _ in range(10):
            worker.gemini_backoff(True, 1000.0)
        self.assertEqual(1300.0, worker._GEMINI_BLOCK_UNTIL)
        worker.gemini_backoff(False, 1000.0)
        self.assertEqual(0.0, worker._GEMINI_BLOCK_UNTIL)

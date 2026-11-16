import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import worker
from live_video import LiveVideo
from runtime import DropOldestExecutor, redact
from worker import Shared, Worker, camera_ids, downscale, run_camera_forever


class DropOldestExecutorTest(unittest.TestCase):
    def test_full_queue_drops_oldest_pending_task_and_keeps_newest(self):
        gate = threading.Event()
        done = []
        executor = DropOldestExecutor("uji", workers=1, max_queue=2)
        executor.submit(gate.wait)  # menahan satu-satunya thread
        time.sleep(0.05)
        first = executor.submit(done.append, "lama")
        executor.submit(done.append, "tengah")
        with self.assertLogs("cctv", "WARNING") as logs:
            newest = executor.submit(done.append, "baru")
        self.assertTrue(first.cancelled())
        self.assertEqual(1, executor.dropped)
        self.assertIn("dibuang", logs.output[0])
        gate.set()
        newest.result(timeout=2)
        executor.shutdown()
        self.assertEqual(["tengah", "baru"], done)


class EnvironmentTest(unittest.TestCase):
    @patch.dict(os.environ, {"CCTV_CAMERA_IDS": "1, 2,3,2"}, clear=False)
    def test_camera_list_from_env_without_duplicates(self):
        self.assertEqual([1, 2, 3], camera_ids())

    @patch.dict(os.environ, {"CCTV_CAMERA_ID": "3"}, clear=False)
    def test_legacy_single_camera_env_still_works(self):
        os.environ.pop("CCTV_CAMERA_IDS", None)
        self.assertEqual([3], camera_ids())

    def test_password_never_reaches_logs(self):
        text = redact("gagal rtsp://dvr:Rahasia25@100.118.114.23:8554/Streaming/Channels/1301")
        self.assertNotIn("Rahasia25", text)
        self.assertIn("rtsp://***@100.118.114.23:8554", text)

    def test_frames_are_shrunk_to_working_width_early(self):
        frame = np.zeros((1080, 1920, 3), dtype=np.uint8)
        self.assertEqual((360, 640, 3), downscale(frame, 640).shape)
        small = np.zeros((360, 640, 3), dtype=np.uint8)
        self.assertIs(small, downscale(small, 1280))


def bare_worker(camera_id=1, label=False, model=None, source="rtsp://u:p@dvr:8554/Streaming/Channels/1201"):
    item = Worker.__new__(Worker)
    item.camera_id = camera_id
    item.label_enabled = label
    item.model = model
    item.source = source
    item.stop_event = threading.Event()
    return item


class DetectSourceTest(unittest.TestCase):
    @patch.dict(os.environ, {"CCTV_DETECT_USE_SUBSTREAM": "auto"}, clear=False)
    def test_auto_mode_uses_substream_only_without_model_and_without_label(self):
        self.assertTrue(bare_worker().detect_source().endswith("/1202"))
        self.assertTrue(bare_worker(model=object()).detect_source().endswith("/1201"))
        label = bare_worker(label=True, source="rtsp://u:p@dvr:8554/Streaming/Channels/1401")
        self.assertTrue(label.detect_source().endswith("/1401"))

    @patch.dict(os.environ, {"CCTV_DETECT_USE_SUBSTREAM": "false"}, clear=False)
    def test_substream_can_be_switched_off(self):
        self.assertTrue(bare_worker().detect_source().endswith("/1201"))


class FakeCapture:
    def __init__(self, frames):
        self.frames = frames
        self.grabs = self.retrieves = 0
        self.options = {}

    def isOpened(self):
        return True

    def set(self, key, value):
        self.options[key] = value

    def get(self, key):
        return 0

    def grab(self):
        self.grabs += 1
        return self.grabs <= self.frames

    def retrieve(self):
        self.retrieves += 1
        return True, np.zeros((1080, 1920, 3), dtype=np.uint8)

    def release(self):
        pass


class CaptureLoopTest(unittest.TestCase):
    def test_only_frames_due_at_process_fps_are_decoded_to_images_and_resized(self):
        item = bare_worker()
        item.process_fps = 3
        item.work_width = 640
        item.last_frame = item.last_heartbeat = 0.0
        item.reconnect_delay = 5.0
        item.ring, item.pending, item.zones = [], [], []
        item.live_video = None
        processed = []
        capture = FakeCapture(frames=30)
        clock = iter(i * (1 / 15) for i in range(10_000))  # kamera 15 fps
        item.schedule_spool_retry = item.schedule_live = lambda: None
        item.heartbeat = lambda status: None
        item.process_frame = lambda frame, now: processed.append(frame.shape)
        item._open_capture = lambda: capture
        def stop_after_stream(*_):
            item.stop_event.set()
        item.heartbeat = lambda status: stop_after_stream() if status == "offline" else None
        with patch("worker.time.monotonic", side_effect=lambda: next(clock)):
            item.run()
        self.assertEqual(31, capture.grabs)  # semua frame diambil agar tidak tertinggal
        self.assertLessEqual(capture.retrieves, 8)  # hanya ±3 per detik yang diubah jadi gambar
        self.assertGreaterEqual(capture.retrieves, 5)
        self.assertTrue(all(shape == (360, 640, 3) for shape in processed))


class CameraIsolationTest(unittest.TestCase):
    def test_one_failing_camera_retries_without_stopping_the_others(self):
        stop = threading.Event()
        runs = {1: 0, 2: 0}

        class FakeWorker:
            def __init__(self, camera_id, shared, stop_event):
                self.camera_id = camera_id
                if camera_id == 2:
                    runs[2] += 1
                    raise RuntimeError("rtsp://dvr:Rahasia25@host gagal")

            def run(self):
                runs[1] += 1
                stop.wait(0.05)

        with patch("worker.Worker", FakeWorker), patch.object(stop, "wait", side_effect=lambda t=None: time.sleep(0.01)):
            threads = [threading.Thread(target=run_camera_forever, args=(cid, None, stop)) for cid in (1, 2)]
            with self.assertLogs("cctv", "ERROR") as logs:
                for thread in threads:
                    thread.start()
                time.sleep(0.3)
                stop.set()
                for thread in threads:
                    thread.join(timeout=2)
        self.assertGreater(runs[1], 1)
        self.assertGreater(runs[2], 1)
        self.assertFalse(any("Rahasia25" in line for line in logs.output))


class LiveOnDemandTest(unittest.TestCase):
    def make(self, directory):
        item = bare_worker()
        item.live_video = LiveVideo(directory, 1, fps=6, source="rtsp://example/Streaming/Channels/1201")
        item.live_future = None
        item.live_on_demand = True
        item.live_idle_seconds = 45
        item.live_executor = DropOldestExecutor("live-uji", workers=1, max_queue=2)
        return item

    def test_live_starts_only_when_someone_watches_and_stops_when_idle(self):
        with tempfile.TemporaryDirectory() as directory:
            item = self.make(directory)
            calls = []
            item.live_video.ensure_running = lambda: calls.append("start")
            item.schedule_live()
            time.sleep(0.05)
            self.assertEqual([], calls)  # tidak ada penonton: DVR tidak dibebani
            item.live_video.viewer_marker.touch()
            item.schedule_live()
            time.sleep(0.05)
            self.assertEqual(["start"], calls)

            class Running:
                def poll(self):
                    return None
            item.live_video.process = Running()
            stale = time.time() - 120
            os.utime(item.live_video.viewer_marker, (stale, stale))
            closed = []
            item.live_video.close = lambda: closed.append(True)
            item.live_future = None
            item.schedule_live()
            time.sleep(0.05)
            self.assertEqual([True], closed)
            item.live_executor.shutdown()


class SharedModelTest(unittest.TestCase):
    def test_ultralytics_is_imported_once_for_all_cameras(self):
        shared = Shared()
        imports = []

        class FakeYolo:
            def __init__(self, path):
                self.path = path

        fake_module = type(sys)("ultralytics")
        fake_module.YOLO = FakeYolo
        original_import = __import__

        def counting_import(name, *args, **kwargs):
            if name == "ultralytics":
                imports.append(name)
                return fake_module
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=counting_import):
            first = shared.load_model("model.pt")
            second = shared.load_model("model.pt")
        shared.shutdown()
        self.assertEqual(1, len(imports))
        self.assertIsNot(first, second)  # pelacakan per kamera tetap terpisah


if __name__ == "__main__":
    unittest.main()


class ResolveHostTest(unittest.TestCase):
    def test_host_name_becomes_ip_and_credentials_stay(self):
        from live_video import with_resolved_host
        with patch("live_video.socket.gethostbyname", return_value="100.118.114.23"):
            self.assertEqual("rtsp://dvr:pw@100.118.114.23:8554/Streaming/Channels/1302",
                             with_resolved_host("rtsp://dvr:pw@hype:8554/Streaming/Channels/1302"))
        self.assertEqual("rtsp://u:p@100.118.114.23:8554/x", with_resolved_host("rtsp://u:p@100.118.114.23:8554/x"))
        with patch("live_video.socket.gethostbyname", side_effect=OSError):
            self.assertEqual("rtsp://example/x", with_resolved_host("rtsp://example/x"))

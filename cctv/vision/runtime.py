"""Bagian bersama proses vision multi-kamera: antrian kerja terbatas dan penyensoran URL di log."""

from __future__ import annotations

from collections import deque
from concurrent.futures import Future
import logging
import re
import threading

LOG = logging.getLogger("cctv")
_CREDENTIALS = re.compile(r"(rtsps?://)[^/@\s]+@", re.IGNORECASE)


def redact(text) -> str:
    """Hapus user:password dari URL RTSP sebelum ditulis ke log."""
    return _CREDENTIALS.sub(r"\1***@", str(text))


class DropOldestExecutor:
    """Kumpulan thread dengan antrian berbatas.

    Kalau antrian penuh, tugas terlama yang belum mulai dibuang (dan dicatat) supaya frame
    lama tidak menumpuk di RAM saat jaringan atau API lambat.
    """

    def __init__(self, name: str, workers: int = 1, max_queue: int = 4):
        self.name = name
        self.max_queue = max(1, int(max_queue))
        self.dropped = 0
        self._queue: deque = deque()
        self._cv = threading.Condition()
        self._closed = False
        self._threads = [threading.Thread(target=self._run, name=f"{name}-{index}", daemon=True)
                         for index in range(max(1, int(workers)))]
        for thread in self._threads:
            thread.start()

    def submit(self, fn, *args, **kwargs) -> Future:
        future: Future = Future()
        with self._cv:
            if self._closed:
                raise RuntimeError(f"Antrian {self.name} sudah ditutup")
            if len(self._queue) >= self.max_queue:
                old_future, old_fn, _, _ = self._queue.popleft()
                old_future.cancel()
                self.dropped += 1
                LOG.warning("Antrian %s penuh (%d); tugas terlama %s dibuang (total dibuang %d)",
                            self.name, self.max_queue, getattr(old_fn, "__name__", "?"), self.dropped)
            self._queue.append((future, fn, args, kwargs))
            self._cv.notify()
        return future

    def pending(self) -> int:
        with self._cv:
            return len(self._queue)

    def _run(self):
        while True:
            with self._cv:
                while not self._queue and not self._closed:
                    self._cv.wait()
                if not self._queue:
                    return
                future, fn, args, kwargs = self._queue.popleft()
            if not future.set_running_or_notify_cancel():
                continue
            try:
                future.set_result(fn(*args, **kwargs))
            except BaseException as exc:  # diteruskan ke pemanggil lewat future
                future.set_exception(exc)

    def shutdown(self, wait: bool = True):
        """Tolak tugas baru; tugas yang sudah antre tetap diselesaikan."""
        with self._cv:
            self._closed = True
            self._cv.notify_all()
        if wait:
            for thread in self._threads:
                thread.join()

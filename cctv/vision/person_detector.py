"""Deteksi orang ringan untuk jaga area terlarang: YOLOX-Nano lewat OpenCV DNN, tanpa PyTorch."""
from __future__ import annotations

import logging
import os
import threading

import cv2
import numpy as np

LOG = logging.getLogger("cctv")
INPUT_SIZE = 416
STRIDES = (8, 16, 32)


def _grid() -> tuple[np.ndarray, np.ndarray]:
    grids, strides = [], []
    for stride in STRIDES:
        cells = INPUT_SIZE // stride
        xv, yv = np.meshgrid(np.arange(cells), np.arange(cells))
        grids.append(np.stack((xv, yv), 2).reshape(-1, 2))
        strides.append(np.full((cells * cells, 1), stride))
    return np.concatenate(grids).astype(np.float32), np.concatenate(strides).astype(np.float32)


class PersonDetector:
    """Satu jaringan untuk semua kamera (dikunci saat dipakai). Model baru dimuat saat pertama dibutuhkan."""

    def __init__(self, model_path: str | None = None, min_confidence: float | None = None):
        self.model_path = model_path or os.getenv("CCTV_PERSON_MODEL", os.path.join(os.path.dirname(__file__), "models", "yolox_nano.onnx"))
        self.min_confidence = float(min_confidence if min_confidence is not None else os.getenv("CCTV_PERSON_MIN_CONFIDENCE", "0.45"))
        self._net = None
        self._lock = threading.Lock()
        self._grid, self._strides = _grid()

    def _load(self):
        if self._net is None:
            self._net = cv2.dnn.readNetFromONNX(self.model_path)
            LOG.info("Model deteksi orang dimuat: %s", os.path.basename(self.model_path))
        return self._net

    def detect(self, frame) -> list[dict]:
        """Orang di frame: [{"box": [x1, y1, x2, y2] (0..1), "score": 0..1}], urut dari yang paling yakin."""
        height, width = frame.shape[:2]
        ratio = min(INPUT_SIZE / height, INPUT_SIZE / width)
        resized = cv2.resize(frame, (int(width * ratio), int(height * ratio)), interpolation=cv2.INTER_LINEAR)
        padded = np.full((INPUT_SIZE, INPUT_SIZE, 3), 114, np.uint8)
        padded[:resized.shape[0], :resized.shape[1]] = resized
        blob = cv2.dnn.blobFromImage(padded, 1.0, (INPUT_SIZE, INPUT_SIZE), swapRB=False)
        with self._lock:
            net = self._load()
            net.setInput(blob)
            output = net.forward()[0]
        scores = output[:, 4] * output[:, 5]  # objectness × kelas 0 (person)
        keep = scores >= self.min_confidence
        if not keep.any():
            return []
        rows, scores = output[keep], scores[keep]
        centers = (rows[:, :2] + self._grid[keep]) * self._strides[keep]
        sizes = np.exp(rows[:, 2:4]) * self._strides[keep]
        boxes = np.concatenate([centers - sizes / 2, sizes], axis=1) / ratio
        picked = cv2.dnn.NMSBoxes(boxes.tolist(), scores.tolist(), self.min_confidence, 0.45)
        result = []
        for index in np.array(picked).flatten():
            x, y, w, h = boxes[index]
            result.append({"box": [max(0.0, x / width), max(0.0, y / height), min(1.0, (x + w) / width), min(1.0, (y + h) / height)],
                           "score": float(scores[index])})
        return sorted(result, key=lambda item: item["score"], reverse=True)

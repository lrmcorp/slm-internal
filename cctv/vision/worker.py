from __future__ import annotations

"""Pembaca kamera CCTV. Satu proses melayani semua kamera (satu thread per kamera).

Rahasia kamera dan token ingest hanya dibaca dari environment, dan password RTSP tidak pernah
ditulis ke log.
"""

from collections import deque
from datetime import datetime, timezone
from pathlib import Path
import json
import logging
import math
import os
import random
import re
import signal
import tempfile
import threading
import time
import uuid

# Avoid decoder diagnostics echoing credential-bearing RTSP URLs.
os.environ.setdefault('OPENCV_LOG_LEVEL', 'FATAL')
os.environ.setdefault('OPENCV_FFMPEG_LOGLEVEL', '-8')
# RTSP lewat TCP: UDP tidak bisa melewati penerus port di komputer toko dan Tailscale.
os.environ.setdefault('OPENCV_FFMPEG_CAPTURE_OPTIONS', 'rtsp_transport;tcp')
import cv2
import numpy as np
import requests

from evidence_spool import EvidenceSpool
from live_video import LiveVideo
from logic import CODE, ZoneTracker, clip_playback_fps, normalize_store, parse_label, parse_qr_payload, people_in_zone
from person_detector import PersonDetector
from runtime import DropOldestExecutor, redact, via_relay

# Satu thread decode per proses: tiga kamera tidak berebut CPU dengan aplikasi lain di VPS.
cv2.setNumThreads(1)
cv2.ocl.setUseOpenCL(False)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(threadName)s] %(message)s")
LOG = logging.getLogger("cctv")


def env_flag(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")


def env_ids(name: str) -> list[int]:
    return [int(part) for part in re.split(r"[,\s]+", os.getenv(name, "")) if part.strip().isdigit()]


def downscale(frame, max_width: int):
    """Perkecil sedini mungkin; frame resolusi penuh tidak disimpan lebih lama dari perlu."""
    if max_width <= 0 or frame.shape[1] <= max_width:
        return frame
    scale = max_width / frame.shape[1]
    return cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)


_PYTESSERACT = None
_PYTESSERACT_MISSING_LOGGED = False


def _pytesseract():
    """Tesseract hanya dimuat bila mode label 'auto' benar-benar butuh OCR teks."""
    global _PYTESSERACT, _PYTESSERACT_MISSING_LOGGED
    if _PYTESSERACT is None:
        try:
            import pytesseract
            _PYTESSERACT = pytesseract
        except ImportError:
            if not _PYTESSERACT_MISSING_LOGGED:
                LOG.warning("OCR teks tidak tersedia (image dibuat tanpa tesseract); hanya QR yang dibaca")
                _PYTESSERACT_MISSING_LOGGED = True
            return None
    return _PYTESSERACT
CLIP_SECONDS_BEFORE = 1.5
CLIP_SECONDS_AFTER = 1.5


def jpeg(frame, quality=None) -> bytes:
    q = int(quality if quality is not None else os.getenv("CCTV_JPEG_QUALITY", "84"))
    q = max(40, min(95, q))
    ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, q, cv2.IMWRITE_JPEG_OPTIMIZE, 1])
    if not ok:
        raise RuntimeError("Cannot encode frame")
    return encoded.tobytes()


_LAST_GEMINI_SCAN = 0.0
_GEMINI_FAILS = 0
_GEMINI_BLOCK_UNTIL = 0.0


def gemini_backoff(failed: bool, now: float) -> None:
    """Setelah gagal/tidak terbaca: tunggu 30 dtk, lalu 60, 120 ... maksimum 5 menit."""
    global _GEMINI_FAILS, _GEMINI_BLOCK_UNTIL
    _GEMINI_FAILS = _GEMINI_FAILS + 1 if failed else 0
    _GEMINI_BLOCK_UNTIL = now + min(300.0, 30.0 * 2 ** (_GEMINI_FAILS - 1)) if failed else 0.0


def scan_with_gemini(frame, api_key: str, model: str = None) -> dict | None:
    global _LAST_GEMINI_SCAN
    if not api_key:
        return None
    now = time.monotonic()
    if now - _LAST_GEMINI_SCAN < 3.0 or now < _GEMINI_BLOCK_UNTIL:
        return None
    _LAST_GEMINI_SCAN = now
    model = model or os.getenv("CCTV_AI_MODEL", "gemini-3.5-flash-lite")
    try:
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            return None
        import base64
        b64 = base64.b64encode(buf.tobytes()).decode("utf-8")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        payload = {
            "contents": [{
                "parts": [
                    {
                        "text": (
                            "Anda adalah asisten visual CCTV packing toko. "
                            "Baca kode QR atau nomor invoice, nama customer tujuan, dan tanda toko (Aneka Jaya atau MJ) pada label dus ini. "
                            "Nomor invoice berformat 6 digit - 2 digit (contoh: 061026-23) atau invoice MJ (contoh: MJ-20261117-0005). "
                            "Kembalikan JSON persis: {\"field_one\": \"...\", \"field_two\": \"...\", \"field_three\": \"...\"}."
                        )
                    },
                    {
                        "inline_data": {
                            "mime_type": "image/jpeg",
                            "data": b64
                        }
                    }
                ]
            }],
            "generationConfig": {
                "response_mime_type": "application/json",
                "temperature": 0.1
            }
        }
        res = requests.post(url, json=payload, headers={"x-goog-api-key": api_key}, timeout=6)
        if res.status_code == 200:
            data = res.json()
            text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
            parsed = json.loads(text)
            field_one = parsed.get("field_one")
            if field_one and CODE.fullmatch(field_one):
                field_three = normalize_store(parsed.get("field_three"))
                LOG.info("[AI QR - Model 2 Gemini] Berhasil mendeteksi label via Gemini Vision: Invoice=%s, Cust=%s, Toko=%s",
                         field_one, parsed.get("field_two"), field_three)
                gemini_backoff(False, now)
                return {
                    "field_one": field_one,
                    "field_two": parsed.get("field_two"),
                    "field_three": field_three,
                    "raw_ocr": f"Gemini ({model}): {field_one}",
                    "confidence": 0.98
                }
    except Exception as e:
        LOG.debug("Gemini fallback scan error: %s", type(e).__name__)
    gemini_backoff(True, now)
    return None


# Ringkasan pembacaan label (dicatat tiap 5 menit oleh kamera pembaca label), untuk melihat apakah
# kamera tidak melihat QR sama sekali, melihat tapi gagal membaca, atau membaca tapi isinya bukan invoice.
QR_STATS = {"dipindai": 0, "qr_terlihat": 0, "terbaca": 0, "invoice": 0}
QR_STATS_LOCK = threading.Lock()


def _count_qr(key: str):
    with QR_STATS_LOCK:
        QR_STATS[key] += 1


def qr_stats_snapshot_and_reset() -> dict:
    with QR_STATS_LOCK:
        snapshot = dict(QR_STATS)
        for key in QR_STATS:
            QR_STATS[key] = 0
    return snapshot


def ocr(frame) -> dict | None:
    crop = os.getenv("CCTV_LABEL_ROI")
    if crop:
        x, y, w, h = json.loads(crop)
        height, width = frame.shape[:2]
        frame = frame[int(y * height):int((y + h) * height), int(x * width):int((x + w) * width)]
    if frame.size == 0:
        return None
    # Model 1: Local High-Speed OpenCV QR Detector
    _count_qr("dipindai")
    detector = cv2.QRCodeDetector()
    found, values, _, _ = detector.detectAndDecodeMulti(frame)
    if not found:
        value, points, _ = detector.detectAndDecode(frame)
        values = [value] if value else []
        found = points is not None
    if found:
        _count_qr("qr_terlihat")
    detected = [v.strip() for v in values if v and v.strip()]
    if detected:
        _count_qr("terbaca")
    parsed_candidates = []
    if detected:
        for v in detected:
            res = parse_qr_payload(v)
            if res:
                parsed_candidates.append(res)
            else:
                LOG.info("[AI QR - Model 1 OpenCV] QR Code terdeteksi tetapi bukan format invoice SLM: %s", v[:80])
    unique_invoices = {c["field_one"] for c in parsed_candidates}
    if unique_invoices:
        _count_qr("invoice")
    if len(unique_invoices) == 1:
        best = max(parsed_candidates, key=lambda c: (bool(c["field_two"]), bool(c["field_three"])))
        LOG.info("[AI QR - Model 1 OpenCV] QR Code invoice SLM terbaca: Invoice=%s, Customer=%s, Toko=%s",
                 best["field_one"], best.get("field_two"), best.get("field_three"))
        return best
    if len(unique_invoices) > 1:
        LOG.warning("[AI QR - Model 1 OpenCV] Terdeteksi lebih dari satu nomor invoice berbeda: %s", list(unique_invoices))
        return None

    # Model 2: Google Gemini Multimodal Vision Fallback (bila OpenCV silau/lecek/buram)
    gemini_key = os.getenv("CCTV_AI_API_KEY", "") or os.getenv("GEMINI_API_KEY", "")
    if gemini_key:
        has_qr_contour, _ = detector.detect(frame)
        if not has_qr_contour:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            has_qr_contour, _ = detector.detect(clahe.apply(gray))
        if has_qr_contour or detected:
            gemini_res = scan_with_gemini(frame, gemini_key)
            if gemini_res:
                return gemini_res

    if os.getenv("CCTV_LABEL_MODE", "auto") == "qr":
        return None
    pytesseract = _pytesseract()
    if pytesseract is None:
        return None
    scale = min(1, 1400 / max(frame.shape[:2]))
    frame = cv2.resize(frame, None, fx=scale, fy=scale) if scale < 1 else frame
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    candidates = []
    for rotated in (gray, cv2.rotate(gray, cv2.ROTATE_90_CLOCKWISE),
                    cv2.rotate(gray, cv2.ROTATE_180), cv2.rotate(gray, cv2.ROTATE_90_COUNTERCLOCKWISE)):
        try:
            data = pytesseract.image_to_data(rotated, config="--psm 6", output_type=pytesseract.Output.DICT,
                                             timeout=4)
        except (RuntimeError, pytesseract.TesseractError):
            continue
        groups: dict[tuple[int, int, int], list[str]] = {}
        confidence = []
        for i, word in enumerate(data["text"]):
            if word.strip():
                groups.setdefault((data["block_num"][i], data["par_num"][i], data["line_num"][i]), []).append(word)
                if float(data["conf"][i]) >= 0:
                    confidence.append(float(data["conf"][i]) / 100)
        text = "\n".join(" ".join(words) for words in groups.values())
        parsed = parse_label(text, sum(confidence) / len(confidence) if confidence else 0)
        if parsed:
            candidates.append(parsed)
    return max(candidates, key=lambda item: (bool(item["field_two"]) + bool(item["field_three"]), item["confidence"]),
               default=None)


class Shared:
    """Sumber daya yang dipakai bersama semua kamera dalam satu proses."""

    def __init__(self):
        # Antrian berbatas: bila penuh, tugas terlama dibuang dan dicatat, frame tidak menumpuk di RAM.
        self.ocr = DropOldestExecutor("ocr", workers=1, max_queue=int(os.getenv("CCTV_OCR_QUEUE", "2")))
        self.upload = DropOldestExecutor("upload", workers=2, max_queue=int(os.getenv("CCTV_UPLOAD_QUEUE", "8")))
        self.live = DropOldestExecutor("live", workers=1, max_queue=int(os.getenv("CCTV_LIVE_QUEUE", "6")))
        # Jaga area terlarang: satu detektor orang untuk semua kamera, dimuat saat jaga pertama kali aktif.
        self.guard = DropOldestExecutor("guard", workers=1, max_queue=2)
        self.person = PersonDetector()
        self._model_lock = threading.Lock()
        self._yolo = None

    def load_model(self, model_path: str):
        """Import ultralytics sekali per proses. Tiap kamera tetap punya objek model sendiri karena
        pelacakan (track id) menyimpan keadaan per aliran video."""
        with self._model_lock:
            if self._yolo is None:
                from ultralytics import YOLO  # optional until a calibrated model is supplied
                self._yolo = YOLO
            return self._yolo(model_path)

    def shutdown(self):
        for executor in (self.live, self.ocr, self.upload, self.guard):
            executor.shutdown(wait=True)


class Worker:
    def __init__(self, camera_id: int | None = None, shared: Shared | None = None,
                 stop: threading.Event | None = None):
        self.camera_id = int(camera_id if camera_id is not None else os.environ["CCTV_CAMERA_ID"])
        self.shared = shared or Shared()
        self.stop_event = stop or threading.Event()
        self.api = os.getenv("CCTV_API_BASE", "http://web:8000").rstrip("/")
        self.token = os.environ["CCTV_INGEST_TOKEN"]
        self.session = requests.Session()
        self.session.headers["X-CCTV-Ingest-Token"] = self.token
        stream_key = None
        response = None
        for attempt in range(60):
            if self.stop_event.is_set():
                raise SystemExit(0)
            try:
                response = self.session.get(f"{self.api}/api/ingest/cameras/{self.camera_id}/config", timeout=5)
                if response.status_code == 200:
                    stream_key = response.json().get("stream_env_key")
                    break
            except Exception:
                if attempt % 5 == 0:
                    LOG.info("Menunggu backend CCTV (%s) siap... (percobaan %d/60)", self.api, attempt + 1)
            self.stop_event.wait(2)
        if not stream_key:
            if response is not None:
                response.raise_for_status()
            raise RuntimeError(f"Konfigurasi kamera {self.camera_id} belum tersedia dari backend")
        self.stream_key = stream_key
        self.source = self._source_from_env()
        if not self.source:
            LOG.warning("Variabel stream %s untuk kamera %d belum diset di environment", stream_key, self.camera_id)
        self.last_heartbeat = self.last_ocr = self.last_frame = self.last_qr_stats = 0.0
        self.process_fps = max(1, min(10, float(os.getenv("CCTV_PROCESS_FPS", "5"))))
        self.label_enabled = self._label_enabled()
        # Resolusi kerja: kamera label butuh piksel cukup untuk QR; kamera lain cukup kecil.
        self.work_width = int(os.getenv("CCTV_LABEL_WORK_MAX_WIDTH", "1280") if self.label_enabled
                              else os.getenv("CCTV_WORK_MAX_WIDTH", "640"))
        self.observation_width = int(os.getenv("CCTV_OBSERVATION_MAX_WIDTH", "640"))
        self.last_label: dict[str, float] = {}
        self.zones = []
        self.approved = False
        self.tracker = ZoneTracker([])
        self.ring = deque(maxlen=max(2, math.ceil(CLIP_SECONDS_BEFORE * self.process_fps) + 2))
        self.pending: list[dict] = []
        self.ocr_executor = self.shared.ocr
        self.upload_executor = self.shared.upload
        self.live_executor = self.shared.live
        self.spool = EvidenceSpool(str(Path(os.getenv("CCTV_EVIDENCE_SPOOL", "/var/lib/cctv-spool"))
                                       / str(self.camera_id)))
        self.spool_future = None
        self.last_spool_retry = 0.0
        self.spool_jitter = random.uniform(0, 20)  # tiga kamera tidak mengunggah bersamaan
        self.ocr_future = None
        self.ocr_frame = None
        # Jaga area terlarang (jadwal dan zona dari backend lewat heartbeat).
        self.guard = {"active": False, "zone": None, "cooldown_seconds": 60}
        self.guard_interval = 1.0 / max(0.2, min(5.0, float(os.getenv("CCTV_GUARD_FPS", "2"))))
        self.guard_future = None
        self.last_guard_check = 0.0
        self.last_guard_alert = 0.0
        self.guard_streak = 0
        self.model = None
        self.tracking_session = str(uuid.uuid4())
        self.last_observation = 0.0
        self.observation_interval = max(2.0, min(60.0, float(os.getenv("CCTV_OBSERVATION_INTERVAL", "5.0"))))
        self.observation_future = None
        is_rtsp = self.source.startswith('rtsp://')
        self.live_on_demand = env_flag("CCTV_LIVE_ON_DEMAND", "true")
        self.live_idle_seconds = max(15.0, float(os.getenv("CCTV_LIVE_IDLE_SECONDS", "45")))
        self.live_video = (LiveVideo(os.environ['CCTV_HLS_DIRECTORY'], self.camera_id,
                                     max(5, min(25, float(os.getenv('CCTV_LIVE_FPS', '15')))) if is_rtsp else self.process_fps,
                                     source=os.getenv('CCTV_LIVE_SOURCE', self.source) if is_rtsp else None)
                           if os.getenv('CCTV_HLS_DIRECTORY') else None)
        self.live_future = None
        self.reconnect_delay = 5.0
        self.last_offline_log = 0.0
        self.item_classes = {s.strip() for s in os.getenv("CCTV_ITEM_CLASS_NAMES", "item").split(",")}
        model_path = os.getenv("CCTV_MODEL_PATH")
        model_cameras = env_ids("CCTV_MODEL_CAMERA_IDS")
        if model_path and (not model_cameras or self.camera_id in model_cameras):
            self.model = self.shared.load_model(model_path)
            LOG.info("Detector model loaded untuk kamera %d", self.camera_id)
        else:
            LOG.info("Kamera %d tanpa model deteksi paket; deteksi anomali tidak aktif", self.camera_id)

    @property
    def running(self) -> bool:
        return not self.stop_event.is_set()

    @running.setter
    def running(self, value: bool):
        if not value:
            self.stop_event.set()

    def _source_from_env(self) -> str:
        source = os.environ.get(self.stream_key, "")
        if not source:
            alt_key = self.stream_key.replace("CCTV_CAMERA_", "CCTV_RTSP_").replace("_URL", "")
            source = os.environ.get(alt_key, "")
        return source

    def _label_enabled(self) -> bool:
        """Kamera pembaca label: CCTV_LABEL_CAMERA_IDS (mis. "1"); tanpa itu ikut CCTV_LABEL_ENABLED lama."""
        label_ids = env_ids("CCTV_LABEL_CAMERA_IDS")
        if label_ids:
            return self.camera_id in label_ids
        return env_flag("CCTV_LABEL_ENABLED", "true")

    def _stop(self, signum, frame):
        self.stop_event.set()

    def post(self, endpoint, **kwargs):
        return self.session.post(f"{self.api}/api/ingest/cameras/{self.camera_id}/{endpoint}", timeout=15, **kwargs)

    def post_background(self, endpoint, **kwargs):
        return requests.post(f"{self.api}/api/ingest/cameras/{self.camera_id}/{endpoint}",
                             headers={"X-CCTV-Ingest-Token": self.token}, timeout=15, **kwargs)

    def heartbeat(self, status: str):
        try:
            result = self.post("heartbeat", json={"status": status})
            result.raise_for_status()
            data = result.json()
            self.approved = bool(data["zones_approved"])
            guard = data.get("guard") or {}
            active = bool(guard.get("active")) and bool(guard.get("zone"))
            if active != self.guard["active"]:
                LOG.info("Jaga area terlarang kamera %d %s", self.camera_id, "aktif" if active else "berhenti")
                self.guard_streak = 0
            self.guard = {"active": active, "zone": guard.get("zone"), "cooldown_seconds": float(guard.get("cooldown_seconds") or 60)}
            if data["zones"] != self.zones:
                self.zones = data["zones"] or []
                self.tracker = ZoneTracker(self.zones)
        except requests.RequestException as exc:
            LOG.error("Heartbeat failed: %s", type(exc).__name__)

    def detect(self, frame):
        if not self.model:
            return []
        result = self.model.track(frame, persist=True, verbose=False, conf=0.3)[0]
        output = []
        height, width = frame.shape[:2]
        for box in result.boxes:
            name = result.names[int(box.cls[0])]
            category = "person" if name == "person" else ("item" if name in self.item_classes else None)
            if category is None:
                continue
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            output.append({"id": int(box.id[0]) if box.id is not None else None,
                           "class": category, "center": [((x1 + x2) / 2) / width, ((y1 + y2) / 2) / height],
                           "box": [max(0, min(1, x1 / width)), max(0, min(1, y1 / height)),
                                   max(0, min(1, x2 / width)), max(0, min(1, y2 / height))]})
        return output

    def draw_tracks(self, frame, detections):
        tracks = []
        image = frame.copy()
        height, width = image.shape[:2]
        for item in detections:
            if item['class'] not in ('person', 'item') or item['id'] is None:
                continue
            if item['class'] == 'person':
                tracks.append({'id': str(item['id']), 'box': item['box']})
            color = (0, 220, 255) if item['class'] == 'person' else (140, 240, 70)
            caption = ('Orang ' if item['class'] == 'person' else 'Objek ') + str(item['id'])
            x1, y1, x2, y2 = item['box']
            cv2.rectangle(image, (int(x1 * width), int(y1 * height)),
                          (int(x2 * width), int(y2 * height)), color, 2)
            cv2.putText(image, caption, (int(x1 * width), max(20, int(y1 * height))),
                        cv2.FONT_HERSHEY_SIMPLEX, .6, color, 2)
        return image, tracks

    def send_observation(self, frame, detections):
        image, tracks = self.draw_tracks(frame, detections)
        try:
            result = self.post_background('observations', data={
                'session_id': self.tracking_session, 'detector_ready': int(self.model is not None),
                'tracks': json.dumps(tracks[:50]),
                'objects': json.dumps([{'id': str(item['id']), 'box': item['box']}
                    for item in detections if item['class'] == 'item' and item['id'] is not None][:50]),
            }, files={'snapshot': ('live.jpg', jpeg(downscale(image, getattr(self, 'observation_width', 0)),
                                                    os.getenv('CCTV_LIVE_JPEG_QUALITY', '65')), 'image/jpeg')})
            result.raise_for_status()
        except requests.RequestException as exc:
            LOG.warning('Observation upload failed: %s', type(exc).__name__)

    def check_guard(self, frame, now: float):
        """Orang di area terlarang dua pemeriksaan berturut-turut = peringatan (sekali per jeda)."""
        zone = self.guard["zone"]
        hits = people_in_zone(self.shared.person.detect(frame), zone)
        self.guard_streak = self.guard_streak + 1 if hits else 0
        if self.guard_streak < 2 or now - self.last_guard_alert < self.guard["cooldown_seconds"]:
            return
        image = frame.copy()
        height, width = image.shape[:2]
        polygon = np.array([[int(x * width), int(y * height)] for x, y in zone], np.int32)
        cv2.polylines(image, [polygon], True, (0, 109, 255), 3)
        for person in hits:
            x1, y1, x2, y2 = person["box"]
            cv2.rectangle(image, (int(x1 * width), int(y1 * height)), (int(x2 * width), int(y2 * height)), (0, 0, 255), 3)
            cv2.putText(image, f"Orang {person['score']:.0%}", (int(x1 * width), max(22, int(y1 * height) - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX, .7, (0, 0, 255), 2)
        try:
            result = self.post("guard", data={"observed_at": datetime.now(timezone.utc).isoformat(), "person_count": len(hits),
                                              "confidence": round(max(person["score"] for person in hits), 4)},
                               files={"snapshot": ("guard.jpg", jpeg(downscale(image, 960), "80"), "image/jpeg")})
            if result.status_code in (201, 202):
                self.last_guard_alert = now
                if result.status_code == 201:
                    LOG.info("Kamera %d: %d orang di area terlarang, peringatan dikirim", self.camera_id, len(hits))
            else:
                LOG.warning("Peringatan area terlarang kamera %d ditolak: HTTP %d", self.camera_id, result.status_code)
        except requests.RequestException as exc:
            LOG.warning("Peringatan area terlarang kamera %d gagal dikirim: %s", self.camera_id, type(exc).__name__)

    def send_label(self, frame, label):
        now = time.monotonic()
        key = "|".join(str(label.get(field) or "") for field in ("field_one", "field_two", "field_three"))
        if now - self.last_label.get(key, 0) < 10:
            return
        self.last_label[key] = now
        label["observed_at"] = datetime.now(timezone.utc).isoformat()
        try:
            result = self.post("labels", data=label,
                               files={"snapshot": ("label.jpg", jpeg(frame), "image/jpeg")})
            result.raise_for_status()
            LOG.info("[AI QR] Label invoice %s berhasil disimpan ke database dashboard", label.get("field_one"))
        except requests.RequestException as exc:
            LOG.error("Label ingest failed: %s", type(exc).__name__)

    def start_incident(self, pending):
        data = {**pending["event"], "type": "anomaly", "occurred_at": pending["occurred_at"]}
        snapshot = jpeg(pending["snapshot"])
        for attempt in range(3):
            try:
                result = self.post_background("incidents", data=data,
                    files={"snapshot": ("event.jpg", snapshot, "image/jpeg")})
                result.raise_for_status()
                LOG.info("Suspected incident created; notification queued")
                return True
            except requests.RequestException as exc:
                LOG.warning("Incident start attempt %s failed: %s", attempt + 1, type(exc).__name__)
                if attempt < 2:
                    time.sleep(1 if attempt == 0 else 3)
        return False

    SPOOL_MAX_ATTEMPTS = 10
    SPOOL_MAX_AGE = float(os.getenv("CCTV_SPOOL_MAX_AGE_HOURS", "72")) * 3600

    def retry_spool(self):
        self.spool.prune(self.SPOOL_MAX_AGE, int(float(os.getenv("CCTV_SPOOL_MAX_MB", "2048")) * 1024 * 1024))
        attempts = self.__dict__.setdefault("spool_attempts", {})
        for item in self.spool.pending():
            tried, next_at = attempts.get(item.name, (0, 0.0))
            if time.monotonic() < next_at:
                continue
            try:
                metadata = json.loads((item / "metadata.json").read_text(encoding="utf-8"))
                data = {**metadata["event"], "type": "anomaly",
                        "occurred_at": metadata["occurred_at"]}
                with (item / "event.mp4").open("rb") as clip:
                    result = self.post_background("incidents", data=data, files={
                        "snapshot": ("event.jpg", (item / "snapshot.jpg").read_bytes(), "image/jpeg"),
                        "clip": ("event.mp4", clip, "video/mp4"),
                    })
                    result.raise_for_status()
                self.spool.remove(item)
                attempts.pop(item.name, None)
                LOG.info("Previously unsent incident evidence uploaded")
            except requests.HTTPError as exc:
                code = exc.response.status_code if exc.response is not None else 0
                tried += 1
                if 400 <= code < 500 and code not in (408, 429) or tried >= self.SPOOL_MAX_ATTEMPTS:
                    # Ditolak permanen atau terlalu sering gagal: mengulang tiap menit tidak akan menolong.
                    LOG.error("Evidence dropped after HTTP %s (attempt %s): %s", code, tried, item.name)
                    self.spool.remove(item)
                    attempts.pop(item.name, None)
                else:
                    attempts[item.name] = (tried, time.monotonic() + min(3600.0, 60.0 * 2 ** tried) * random.uniform(1.0, 1.3))
                    LOG.warning("Evidence spool retry failed: HTTP %s", code)
            except requests.RequestException as exc:
                # Server tidak terjangkau: hentikan putaran ini, jangan menghantam item lain.
                LOG.warning("Evidence spool retry failed: %s", type(exc).__name__)
                break
            except (OSError, ValueError, KeyError) as exc:
                LOG.warning("Evidence spool retry failed: %s", type(exc).__name__)

    def schedule_spool_retry(self):
        now = time.monotonic()
        if (now - self.last_spool_retry >= 60 + self.spool_jitter and
                (self.spool_future is None or self.spool_future.done())):
            self.spool_future = self.upload_executor.submit(self.retry_spool)
            self.last_spool_retry = now

    def flush_incident(self, pending):
        frames = pending["frames"]
        if not frames:
            return
        first = frames[0][1]
        height, width = first.shape[:2]
        playback_fps = clip_playback_fps(frames)
        with tempfile.TemporaryDirectory(prefix="cctv-event-") as directory:
            clip_path = Path(directory) / "event.mp4"
            writer = cv2.VideoWriter(str(clip_path), cv2.VideoWriter_fourcc(*"mp4v"), playback_fps, (width, height))
            if not writer.isOpened():
                LOG.error("Cannot create event video")
                return
            for _, image in frames:
                writer.write(image)
            writer.release()
            try:
                started = pending["start_future"].result()
            except Exception:
                LOG.exception("Incident start job failed")
                started = False
            try:
                uploaded = False
                with clip_path.open("rb") as clip:
                    for attempt in range(3):
                        clip.seek(0)
                        try:
                            if started:
                                result = self.post_background(f"incidents/{pending['event']['source_event_id']}/clip",
                                    files={"clip": ("event.mp4", clip, "video/mp4")})
                            else:
                                data = {**pending["event"], "type": "anomaly", "occurred_at": pending["occurred_at"]}
                                result = self.post_background("incidents", data=data, files={
                                    "snapshot": ("event.jpg", jpeg(pending["snapshot"]), "image/jpeg"),
                                    "clip": ("event.mp4", clip, "video/mp4"),
                                })
                            result.raise_for_status()
                            LOG.info("Suspected incident video uploaded")
                            uploaded = True
                            break
                        except requests.RequestException as exc:
                            LOG.warning("Incident video attempt %s failed: %s", attempt + 1, type(exc).__name__)
                            if attempt < 2:
                                time.sleep(1 if attempt == 0 else 3)
            except OSError as exc:
                LOG.error("Incident video could not be read: %s", type(exc).__name__)
            if not uploaded:
                try:
                    saved = self.spool.save(pending["event"], pending["occurred_at"],
                                            jpeg(pending["snapshot"]), clip_path)
                    LOG.error("Incident evidence saved for later upload: %s", saved.name)
                except OSError:
                    LOG.exception("Incident evidence could not be saved on disk")

    def detect_source(self) -> str:
        """Sumber untuk deteksi. Kamera pembaca label selalu memakai main-stream (QR butuh resolusi).

        Kamera lain memakai sub-stream (…02) bila CCTV_DETECT_USE_SUBSTREAM=true, atau pada mode
        "auto" (bawaan) selama kamera itu tidak punya model deteksi paket: tanpa model, frame hanya
        dipakai untuk foto pantauan, jadi resolusi penuh hanya membuang bandwidth dan CPU.
        """
        setting = os.getenv("CCTV_DETECT_USE_SUBSTREAM", "auto").strip().lower()
        use_substream = setting == "true" or (setting == "auto" and self.model is None)
        if use_substream and not self.label_enabled:
            return re.sub(r"(/Streaming/Channels/[0-9]+)01$", r"\g<1>02", self.source)
        return self.source

    def schedule_live(self):
        """Live hanya jalan saat ada penonton (atau selalu bila CCTV_LIVE_ON_DEMAND=false).
        Probing/reconnecting RTSP berjalan di antrian live, tidak menunda QR atau deteksi."""
        if not (self.live_video and self.live_video.source):
            return
        if self.live_future is not None and not self.live_future.done():
            return
        if self.live_future is not None:
            try:
                self.live_future.result()
            except Exception:
                LOG.warning('Live encoder kamera %d belum tersedia; dicoba lagi', self.camera_id)
            self.live_future = None
        if self.live_on_demand and not self.live_video.viewer_active(self.live_idle_seconds):
            if self.live_video.running():
                self.live_future = self.live_executor.submit(self._stop_idle_live)
            return
        if not self.live_video.running():
            self.live_future = self.live_executor.submit(self.live_video.ensure_running)

    def _stop_idle_live(self):
        if self.live_video.stop_if_idle(self.live_idle_seconds):
            LOG.info("Live kamera %d dihentikan: tidak ada penonton %ds", self.camera_id, int(self.live_idle_seconds))

    def _open_capture(self):
        direct = self.detect_source()
        relayed = via_relay(direct)
        if relayed != direct:
            capture = self._capture(relayed)
            if capture.isOpened():
                return capture
            capture.release()
            LOG.warning("Relay go2rtc kamera %d belum siap; membaca langsung dari DVR", self.camera_id)
        return self._capture(direct)

    def _capture(self, source):
        params = [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, int(os.getenv("CCTV_OPEN_TIMEOUT_MS", "10000")),
                  cv2.CAP_PROP_READ_TIMEOUT_MSEC, int(os.getenv("CCTV_READ_TIMEOUT_MS", "10000"))]
        capture = cv2.VideoCapture(source, cv2.CAP_FFMPEG, params)
        # Simpan paling banyak satu frame di buffer decoder: yang diproses selalu frame terbaru.
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return capture

    def _camera_unreachable(self):
        self.heartbeat("offline")
        now = time.monotonic()
        # Cukup satu baris log per 5 menit selama kamera putus; password tidak pernah dicetak.
        if self.reconnect_delay <= 5 or now - self.last_offline_log >= 300:
            LOG.warning("Kamera %d (%s) belum dapat diakses; dicoba lagi dalam %ds",
                        self.camera_id, redact(self.source).split("@", 1)[-1], int(self.reconnect_delay))
            self.last_offline_log = now
        self.stop_event.wait(self.reconnect_delay * random.uniform(0.9, 1.1))
        self.reconnect_delay = min(60.0, self.reconnect_delay * 2)

    def run(self):
        process_period = 1 / self.process_fps
        while self.running:
            self.schedule_spool_retry()
            self.schedule_live()
            if not self.source:
                self.heartbeat("offline")
                LOG.warning("Stream URL kamera %d belum tersedia; mengecek kembali dalam 5 detik...", self.camera_id)
                self.stop_event.wait(5)
                self.source = self._source_from_env()
                continue
            file_source = os.path.isfile(self.source)
            capture = self._open_capture()
            if not capture.isOpened():
                capture.release()
                self._camera_unreachable()
                continue
            if self.reconnect_delay > 5:
                LOG.info("Kamera %d tersambung lagi", self.camera_id)
            self.reconnect_delay = 5.0
            self.ring.clear()
            # Anonymous IDs cannot be linked across reconnects.
            self.tracking_session = str(uuid.uuid4())
            self.tracker = ZoneTracker(self.zones)
            self.heartbeat("online")
            self.last_heartbeat = time.monotonic()
            source_period = 1 / max(1, capture.get(cv2.CAP_PROP_FPS)) if file_source else 0
            while capture.isOpened() and self.running:
                # grab() mengambil frame tanpa konversi warna; retrieve() hanya untuk frame yang diproses.
                if not capture.grab():
                    break
                if source_period:
                    time.sleep(source_period)
                now = time.monotonic()
                self.schedule_spool_retry()
                if now - self.last_heartbeat >= 10:
                    self.heartbeat("online")
                    self.last_heartbeat = now
                self.schedule_live()
                if now - self.last_frame < process_period:
                    continue
                ok, frame = capture.retrieve()
                if not ok:
                    break
                self.last_frame = now
                frame = downscale(frame, self.work_width)
                self.process_frame(frame, now)
            for item in self.pending[:]:
                self.upload_executor.submit(self.flush_incident, item)
                self.pending.remove(item)
            capture.release()
            if self.running:
                self.heartbeat("offline")
                self.stop_event.wait(3)
        if self.live_video:
            self.live_video.close()

    def process_frame(self, frame, now: float):
        anomaly_active = self.model is not None
        if anomaly_active:
            # Klip bukti hanya perlu bila deteksi anomali aktif; tanpa model tidak ada salinan frame.
            self.ring.append((now, frame))
            while self.ring and now - self.ring[0][0] > CLIP_SECONDS_BEFORE:
                self.ring.popleft()
        if self.ocr_future is not None and self.ocr_future.done():
            try:
                if not self.ocr_future.cancelled():
                    label = self.ocr_future.result()
                    if label:
                        self.send_label(self.ocr_frame, label)
            except Exception:
                LOG.exception("Label OCR failed")
            self.ocr_future = None
            self.ocr_frame = None
        if self.label_enabled and now - self.last_ocr >= 2 and self.ocr_future is None:
            self.ocr_frame = frame
            self.ocr_future = self.ocr_executor.submit(ocr, self.ocr_frame)
            self.last_ocr = now
        if self.label_enabled and now - self.last_qr_stats >= 300:
            if self.last_qr_stats:
                stats = qr_stats_snapshot_and_reset()
                LOG.info("[QR 5 menit] kamera %d: %d frame dipindai, QR terlihat di %d, terbaca %d, berisi invoice %d",
                         self.camera_id, stats["dipindai"], stats["qr_terlihat"], stats["terbaca"], stats["invoice"])
            else:
                qr_stats_snapshot_and_reset()
            self.last_qr_stats = now
        if (self.guard["active"] and now - self.last_guard_check >= self.guard_interval
                and (self.guard_future is None or self.guard_future.done())):
            self.guard_future = self.shared.guard.submit(self.check_guard, frame, now)
            self.last_guard_check = now
        detections = self.detect(frame)
        if self.live_video and not self.live_video.source and (self.live_future is None or self.live_future.done()):
            image, _ = self.draw_tracks(frame, detections)
            self.live_future = self.live_executor.submit(self.live_video.write, image)
        if (now - self.last_observation >= self.observation_interval and
                (self.observation_future is None or self.observation_future.done())):
            self.observation_future = self.upload_executor.submit(self.send_observation, frame, detections)
            self.last_observation = now
        event = self.tracker.update(detections, now) if self.approved else None
        if event:
            pending = {"event": event, "occurred_at": datetime.now(timezone.utc).isoformat(),
                       "snapshot": frame, "frames": list(self.ring),
                       "last_frame_at": now, "until": now + CLIP_SECONDS_AFTER}
            pending["start_future"] = self.upload_executor.submit(self.start_incident, pending)
            self.pending.append(pending)
        max_after = math.ceil(CLIP_SECONDS_AFTER * self.process_fps) + 2
        for item in self.pending[:]:
            if now > item["last_frame_at"] and now <= item["until"] and len(item["frames"]) < len(self.ring) + max_after:
                item["frames"].append((now, frame))
                item["last_frame_at"] = now
            if now >= item["until"]:
                self.upload_executor.submit(self.flush_incident, item)
                self.pending.remove(item)


def camera_ids() -> list[int]:
    """Daftar kamera dari CCTV_CAMERA_IDS (mis. "1,2,3"); kompatibel dengan CCTV_CAMERA_ID lama."""
    ids = env_ids("CCTV_CAMERA_IDS") or env_ids("CCTV_CAMERA_ID")
    if not ids:
        raise SystemExit("Isi CCTV_CAMERA_IDS (mis. 1,2,3) atau CCTV_CAMERA_ID")
    return list(dict.fromkeys(ids))


def run_camera_forever(camera_id: int, shared: Shared, stop: threading.Event):
    """Error satu kamera tidak mematikan kamera lain: dicoba lagi dengan jeda bertahap."""
    delay = 5.0
    while not stop.is_set():
        try:
            Worker(camera_id, shared, stop).run()
            delay = 5.0
        except SystemExit:
            return
        except Exception as exc:
            LOG.error("Kamera %d berhenti karena %s: %s; dicoba lagi dalam %ds",
                      camera_id, type(exc).__name__, redact(exc), int(delay))
            stop.wait(delay)
            delay = min(120.0, delay * 2)


def main():
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    shared = Shared()
    ids = camera_ids()
    LOG.info("Vision multi-kamera aktif untuk kamera %s", ", ".join(map(str, ids)))
    threads = [threading.Thread(target=run_camera_forever, args=(camera_id, shared, stop),
                                name=f"cam-{camera_id}", daemon=True) for camera_id in ids]
    for thread in threads:
        thread.start()
    while not stop.is_set():
        stop.wait(1)
    for thread in threads:
        thread.join(timeout=15)
    shared.shutdown()


if __name__ == "__main__":
    main()

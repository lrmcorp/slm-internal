from __future__ import annotations

"""Continuous camera reader. Camera and ingest secrets come only from the environment."""

from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
import json
import logging
import os
import random
import re
import signal
import tempfile
import time
import uuid

# Avoid decoder diagnostics echoing credential-bearing RTSP URLs.
os.environ.setdefault('OPENCV_LOG_LEVEL', 'FATAL')
os.environ.setdefault('OPENCV_FFMPEG_LOGLEVEL', '-8')
import cv2
import pytesseract
import requests

from evidence_spool import EvidenceSpool
from live_video import LiveVideo
from logic import CODE, ZoneTracker, clip_playback_fps, normalize_store, parse_label, parse_qr_payload

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
LOG = logging.getLogger("cctv")
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
                            "Nomor invoice format 6 digit - 2 digit (contoh: 061026-23). "
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


def ocr(frame) -> dict | None:
    crop = os.getenv("CCTV_LABEL_ROI")
    if crop:
        x, y, w, h = json.loads(crop)
        height, width = frame.shape[:2]
        frame = frame[int(y * height):int((y + h) * height), int(x * width):int((x + w) * width)]
    if frame.size == 0:
        return None
    # Model 1: Local High-Speed OpenCV QR Detector
    detector = cv2.QRCodeDetector()
    found, values, _, _ = detector.detectAndDecodeMulti(frame)
    if not found:
        value, _, _ = detector.detectAndDecode(frame)
        values = [value] if value else []
    detected = [v.strip() for v in values if v and v.strip()]
    parsed_candidates = []
    if detected:
        for v in detected:
            res = parse_qr_payload(v)
            if res:
                parsed_candidates.append(res)
            else:
                LOG.info("[AI QR - Model 1 OpenCV] QR Code terdeteksi tetapi bukan format invoice SLM: %s", v)
    unique_invoices = {c["field_one"] for c in parsed_candidates}
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


class Worker:
    def __init__(self):
        self.camera_id = int(os.environ["CCTV_CAMERA_ID"])
        self.api = os.getenv("CCTV_API_BASE", "http://web:8000").rstrip("/")
        self.token = os.environ["CCTV_INGEST_TOKEN"]
        self.session = requests.Session()
        self.session.headers["X-CCTV-Ingest-Token"] = self.token
        stream_key = None
        for attempt in range(60):
            try:
                response = self.session.get(f"{self.api}/api/ingest/cameras/{self.camera_id}/config", timeout=5)
                if response.status_code == 200:
                    stream_key = response.json().get("stream_env_key")
                    break
            except Exception as e:
                if attempt % 5 == 0:
                    LOG.info("Menunggu backend CCTV (%s) siap... (percobaan %d/60)", self.api, attempt + 1)
            time.sleep(2)
        if not stream_key:
            response.raise_for_status()
        self.stream_key = stream_key
        self.source = os.environ.get(stream_key, "")
        if not self.source:
            alt_key = stream_key.replace("CCTV_CAMERA_", "CCTV_RTSP_").replace("_URL", "")
            self.source = os.environ.get(alt_key, "")
        if not self.source:
            LOG.warning("Variabel stream %s untuk kamera %d belum diset di environment", stream_key, self.camera_id)
        self.last_heartbeat = self.last_ocr = self.last_frame = 0.0
        self.process_fps = max(1, min(10, float(os.getenv("CCTV_PROCESS_FPS", "5"))))
        self.last_label: dict[str, float] = {}
        self.zones = []
        self.approved = False
        self.tracker = ZoneTracker([])
        self.ring = deque(maxlen=20)
        self.pending: list[dict] = []
        self.ocr_executor = ThreadPoolExecutor(max_workers=1)
        self.upload_executor = ThreadPoolExecutor(max_workers=2)
        self.spool = EvidenceSpool(str(Path(os.getenv("CCTV_EVIDENCE_SPOOL", "/var/lib/cctv-spool"))
                                       / str(self.camera_id)))
        self.spool_future = None
        self.last_spool_retry = 0.0
        self.spool_jitter = random.uniform(0, 20)  # tiga kamera tidak mengunggah bersamaan
        self.ocr_future = None
        self.ocr_frame = None
        self.model = None
        self.tracking_session = str(uuid.uuid4())
        self.last_observation = 0.0
        self.observation_interval = max(2.0, min(60.0, float(os.getenv("CCTV_OBSERVATION_INTERVAL", "5.0"))))
        self.observation_future = None
        self.live_video = (LiveVideo(os.environ['CCTV_HLS_DIRECTORY'], self.camera_id,
                                     max(5, min(25, float(os.getenv('CCTV_LIVE_FPS', '15')))) if self.source.startswith('rtsp://') else self.process_fps,
                                     source=os.getenv('CCTV_LIVE_SOURCE', self.source) if self.source.startswith('rtsp://') else None)
                           if os.getenv('CCTV_HLS_DIRECTORY') else None)
        self.live_executor = ThreadPoolExecutor(max_workers=1)
        self.live_future = None
        self.running = True
        signal.signal(signal.SIGTERM, self._stop)
        signal.signal(signal.SIGINT, self._stop)
        self.item_classes = {s.strip() for s in os.getenv("CCTV_ITEM_CLASS_NAMES", "item").split(",")}
        model_path = os.getenv("CCTV_MODEL_PATH")
        if model_path:
            from ultralytics import YOLO  # optional until a calibrated model is supplied
            self.model = YOLO(model_path)
            LOG.info("Detector model loaded")
        else:
            LOG.warning("No parcel detector model configured; anomaly detection is inactive")

    def _stop(self, signum, frame):
        self.running = False

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
            }, files={'snapshot': ('live.jpg', jpeg(image, os.getenv('CCTV_LIVE_JPEG_QUALITY', '65')), 'image/jpeg')})
            result.raise_for_status()
        except requests.RequestException as exc:
            LOG.warning('Observation upload failed: %s', type(exc).__name__)

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
        """Kamera tanpa pembacaan label boleh memakai sub-stream (…02) untuk deteksi: bandwidth dan CPU jauh lebih kecil.
        Opt-in karena bukti foto/klip ikut beresolusi sub-stream; uji kualitas pada rekaman nyata dahulu."""
        if os.getenv("CCTV_DETECT_USE_SUBSTREAM", "false").lower() == "true" \
                and os.getenv("CCTV_LABEL_ENABLED", "true").lower() != "true":
            return re.sub(r"(/Streaming/Channels/[0-9]+)01$", r"\g<1>02", self.source)
        return self.source

    def schedule_live(self):
        # Probing/reconnecting RTSP must not delay QR or anomaly processing.
        if self.live_video and self.live_video.source and (self.live_future is None or self.live_future.done()):
            if self.live_future is not None:
                try:
                    self.live_future.result()
                except Exception:
                    LOG.warning('Live encoder unavailable; will retry')
            self.live_future = self.live_executor.submit(self.live_video.ensure_running)

    def run(self):
        os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
        process_period = 1 / self.process_fps
        file_source = os.path.isfile(self.source)
        while self.running:
            self.schedule_spool_retry()
            self.schedule_live()
            if not self.source:
                self.heartbeat("offline")
                LOG.warning("Stream URL kamera %d belum tersedia; mengecek kembali dalam 5 detik...", self.camera_id)
                time.sleep(5)
                self.source = os.environ.get(self.stream_key, "")
                if not self.source:
                    alt_key = self.stream_key.replace("CCTV_CAMERA_", "CCTV_RTSP_").replace("_URL", "")
                    self.source = os.environ.get(alt_key, "")
                continue
            capture = cv2.VideoCapture(self.detect_source(), cv2.CAP_FFMPEG)
            if not capture.isOpened():
                self.heartbeat("offline")
                LOG.warning("Camera stream kamera %d (%s) belum dapat diakses; mencoba kembali...", self.camera_id, str(self.source).split("@", 1)[-1])
                time.sleep(5)
                continue
            self.ring.clear()
            # Anonymous IDs cannot be linked across reconnects.
            self.tracking_session = str(uuid.uuid4())
            self.tracker = ZoneTracker(self.zones)
            self.heartbeat("online")
            source_period = 1 / max(1, capture.get(cv2.CAP_PROP_FPS)) if file_source else 0
            while capture.isOpened() and self.running:
                ok, frame = capture.read()
                if not ok:
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
                self.last_frame = now
                scale = min(1, 1280 / frame.shape[1])
                if scale < 1:
                    frame = cv2.resize(frame, None, fx=scale, fy=scale)
                self.ring.append((now, frame.copy()))
                while self.ring and now - self.ring[0][0] > CLIP_SECONDS_BEFORE:
                    self.ring.popleft()
                if self.ocr_future is not None and self.ocr_future.done():
                    try:
                        label = self.ocr_future.result()
                        if label:
                            self.send_label(self.ocr_frame, label)
                    except Exception:
                        LOG.exception("Label OCR failed")
                    self.ocr_future = None
                    self.ocr_frame = None
                if (os.getenv("CCTV_LABEL_ENABLED", "true").lower() == "true"
                        and now - self.last_ocr >= 2 and self.ocr_future is None):
                    self.ocr_frame = frame.copy()
                    self.ocr_future = self.ocr_executor.submit(ocr, self.ocr_frame)
                    self.last_ocr = now
                detections = self.detect(frame)
                if self.live_video and not self.live_video.source and (self.live_future is None or self.live_future.done()):
                    image, _ = self.draw_tracks(frame, detections)
                    self.live_future = self.live_executor.submit(self.live_video.write, image)
                if (now - self.last_observation >= self.observation_interval and
                        (self.observation_future is None or self.observation_future.done())):
                    self.observation_future = self.upload_executor.submit(self.send_observation, frame.copy(), detections)
                    self.last_observation = now
                event = self.tracker.update(detections, now) if self.approved else None
                if event:
                    pending = {"event": event, "occurred_at": datetime.now(timezone.utc).isoformat(),
                               "snapshot": frame.copy(), "frames": list(self.ring),
                               "last_frame_at": now, "until": now + CLIP_SECONDS_AFTER}
                    pending["start_future"] = self.upload_executor.submit(self.start_incident, pending)
                    self.pending.append(pending)
                for item in self.pending[:]:
                    if now > item["last_frame_at"] and now <= item["until"]:
                        item["frames"].append((now, frame.copy()))
                        item["last_frame_at"] = now
                    if now >= item["until"]:
                        self.upload_executor.submit(self.flush_incident, item)
                        self.pending.remove(item)
            for item in self.pending[:]:
                self.upload_executor.submit(self.flush_incident, item)
                self.pending.remove(item)
            capture.release()
            if self.running:
                self.heartbeat("offline")
                time.sleep(3)
        self.live_executor.shutdown(wait=True)
        if self.live_video:
            self.live_video.close()
        self.ocr_executor.shutdown(wait=True)
        self.upload_executor.shutdown(wait=True)


if __name__ == "__main__":
    Worker().run()

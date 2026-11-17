from __future__ import annotations

"""Pure rules for label parsing and suspected parcel movement."""

from dataclasses import dataclass, field
from math import hypot
import re
import time
import uuid

# Nomor invoice SLM (171126-05) atau invoice MJ (MJ-20261117-0005).
CODE = re.compile(r"(MJ-\d{8}-\d{4}|(?<!\d)\d{6}-\d{2})(?!\d)")


def normalize_store(val: str | None) -> str | None:
    if not val:
        return None
    val_upper = val.upper()
    if "MJ" in val_upper:
        return "MJ"
    if "AJ" in val_upper or "ANEKA JAYA" in val_upper:
        return "Aneka Jaya"
    return None


def parse_qr_payload(text: str) -> dict | None:
    """Parse QR code payload. Extracts invoice, customer, and store source directly."""
    if not text or not text.strip():
        return None

    cleaned = text.strip()
    if re.match(r"^https?://", cleaned, re.IGNORECASE):
        return None

    match = CODE.search(cleaned)
    if not match:
        return None
    invoice_code = match.group(1)

    field_two = None
    field_three = None

    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]

    # 1. Multi-line labeled format (e.g. INVOICE: ..., CUSTOMER: ..., ASAL: ...)
    for line in lines:
        upper = line.upper()
        if re.match(r"^(?:CUSTOMER|CUST|PELANGGAN|NAMA)\s*[:=\-]\s*", upper):
            cust_val = re.sub(r"^(?:CUSTOMER|CUST|PELANGGAN|NAMA)\s*[:=\-]\s*", "", line, flags=re.IGNORECASE).strip()
            if cust_val:
                field_two = cust_val
        elif re.match(r"^(?:ASAL|TOKO|SUMBER|CABANG)\s*[:=\-]\s*", upper):
            store_val = re.sub(r"^(?:ASAL|TOKO|SUMBER|CABANG)\s*[:=\-]\s*", "", line, flags=re.IGNORECASE).strip()
            field_three = normalize_store(store_val)

    # 2. Store marker fallback from whole text
    if not field_three:
        field_three = normalize_store(cleaned)

    # 3. Delimiter fallback (e.g. 121026-23 | ARI BOGOR | AJ)
    if not field_two and ("|" in cleaned or "\n" in cleaned or ";" in cleaned):
        delims = ["|", "\n", ";"]
        chosen_delim = next((d for d in delims if d in cleaned), None)
        if chosen_delim:
            parts = [p.strip() for p in cleaned.split(chosen_delim) if p.strip()]
            for p in parts:
                if invoice_code in p:
                    continue
                p_store = normalize_store(p)
                if p_store:
                    if not field_three:
                        field_three = p_store
                    continue
                if len(p) >= 2 and not field_two and not any(p.upper().startswith(k) for k in ["ALAMAT:", "PETUGAS:"]):
                    field_two = p

    return {
        "field_one": invoice_code,
        "field_two": field_two,
        "field_three": field_three,
        "raw_ocr": "QR: " + cleaned[:2000],
        "confidence": 1.0,
    }


def parse_label(text: str, confidence: float) -> dict | None:
    """Keep leading zeroes; return incomplete reads for human review."""
    text = re.sub(r"[-—–−‐‑]+", "-", text)
    lines = [re.sub(r"\s+", " ", line).strip(" -|:") for line in text.upper().splitlines()]
    lines = [line for line in lines if line]
    match = CODE.search(" ".join(lines))
    if not match:
        return None
    code = match.group(1)
    other = [line for line in lines if code not in line and len(line) >= 2]
    field_two = next((line for line in other if len(line) >= 5 and line not in {"ANEKA JAYA", "MJ", "SIP"}), None)
    field_three = next((line for line in other if line in {"ANEKA JAYA", "MJ"}), None)
    return {
        "field_one": code, "field_two": field_two, "field_three": field_three,
        "raw_ocr": text[:2000], "confidence": min(1.0, max(0.0, confidence)),
    }


def inside(point: tuple[float, float], polygon: list[list[float]]) -> bool:
    if len(polygon) < 3:
        return False
    x, y = point
    hit = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            hit = not hit
        j = i
    return hit


def clip_playback_fps(frames: list[tuple[float, object]]) -> float:
    """Use capture timestamps so a 3-second event window plays for about 3 seconds."""
    if len(frames) < 2:
        return 1.0
    span = frames[-1][0] - frames[0][0]
    return max(1.0, min(10.0, (len(frames) - 1) / span)) if span > 0 else 1.0


@dataclass
class Track:
    from_box: bool = False
    touched_packing: bool = False
    near_person: bool = False
    last_seen: float = field(default_factory=time.monotonic)


class ZoneTracker:
    def __init__(self, zones: list[dict]):
        self.zones = {zone["type"]: zone["points"] for zone in zones}
        self.tracks: dict[int, Track] = {}
        self.crossings: list[float] = []
        self.last_event = 0.0

    def update(self, detections: list[dict], now: float | None = None) -> dict | None:
        """Detections use normalized center [x,y], persistent id, and class name."""
        now = now if now is not None else time.monotonic()
        required = {"store_boundary", "box_area", "packing_route"}
        if not required.issubset(self.zones):
            return None
        people = [tuple(d["center"]) for d in detections if d["class"] == "person"]
        for d in detections:
            if d["class"] != "item" or d.get("id") is None:
                continue
            point = tuple(d["center"])
            track = self.tracks.setdefault(int(d["id"]), Track())
            track.last_seen = now
            track.from_box |= inside(point, self.zones["box_area"])
            track.touched_packing |= inside(point, self.zones["packing_route"])
            track.near_person |= any(hypot(point[0] - p[0], point[1] - p[1]) < 0.22 for p in people)
            outside_store = not inside(point, self.zones["store_boundary"])
            in_danger = "danger_zone" not in self.zones or inside(point, self.zones["danger_zone"])
            if track.from_box and track.near_person and not track.touched_packing and outside_store and in_danger:
                self.crossings.append(now)
                del self.tracks[int(d["id"])]
        self.tracks = {k: v for k, v in self.tracks.items() if now - v.last_seen < 20}
        self.crossings = [t for t in self.crossings if now - t < 3]
        if self.crossings and now - self.crossings[0] >= 1 and now - self.last_event >= 10:
            count = len(self.crossings)
            self.crossings.clear()
            self.last_event = now
            if 1 <= count <= 3:
                return {
                    "source_event_id": str(uuid.uuid4()), "item_count": count,
                    "exited_boundary": True, "passed_packing_route": False,
                    "reason": f"Objek terlacak dari area asal barang ke luar batas toko dekat seseorang, tanpa melewati jalur pengemasan; perkiraan {count} pcs. Perlu diperiksa manusia.",
                }
        return None

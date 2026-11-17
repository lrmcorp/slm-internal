import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from logic import ZoneTracker, clip_playback_fps, normalize_store, parse_label, parse_qr_payload


ZONES = [
    {"type": "store_boundary", "points": [[0, 0], [0.8, 0], [0.8, 1], [0, 1]]},
    {"type": "box_area", "points": [[0.1, 0.1], [0.4, 0.1], [0.4, 0.5], [0.1, 0.5]]},
    {"type": "packing_route", "points": [[0.45, 0.1], [0.6, 0.1], [0.6, 0.5], [0.45, 0.5]]},
]


class VisionRulesTest(unittest.TestCase):
    def test_leading_zero_is_text_and_uncertain_fields_remain_missing(self):
        label = parse_label("061026-23\nTK HANSEL ASK\nMJ", .91)
        self.assertEqual("061026-23", label["field_one"])
        self.assertEqual("TK HANSEL ASK", label["field_two"])
        self.assertEqual("MJ", label["field_three"])
        self.assertIsNone(parse_label("unreadable", .2))
        self.assertIsNone(parse_label("061026-23", .2)["field_two"])
        self.assertIsNone(parse_label("061026-23\nTK HANSEL ASK\nUNKNOWN", .9)["field_three"])
        self.assertIsNone(parse_label("061026-23\nTK HANSEL ASK\nSIP", .9)["field_three"])

    def test_boundary_without_packing_triggers_only_suspected_incident(self):
        tracker = ZoneTracker(ZONES)
        tracker.update([{"id": 1, "class": "person", "center": [.3, .3]},
                        {"id": 12, "class": "item", "center": [.3, .3]}], 100)
        tracker.update([{"id": 1, "class": "person", "center": [.81, .3]},
                        {"id": 12, "class": "item", "center": [.82, .3]}], 101)
        event = tracker.update([], 102.2)
        self.assertEqual(1, event["item_count"])
        self.assertIn("Perlu diperiksa manusia", event["reason"])
        self.assertIsNone(tracker.update([], 103))

    def test_packing_route_and_unapproved_zones_do_not_trigger(self):
        tracker = ZoneTracker(ZONES)
        tracker.update([{"id": 1, "class": "person", "center": [.3, .3]},
                        {"id": 12, "class": "item", "center": [.3, .3]}], 100)
        tracker.update([{"id": 12, "class": "item", "center": [.5, .3]}], 101)
        tracker.update([{"id": 12, "class": "item", "center": [.82, .3]}], 102)
        self.assertIsNone(tracker.update([], 104))
        self.assertIsNone(ZoneTracker([]).update([{"id": 2, "class": "item", "center": [.9, .4]}], 100))

    def test_danger_zone_restricts_suspected_exit_to_left_side(self):
        zones = [
            {"type": "store_boundary", "points": [[.2, 0], [.8, 0], [.8, 1], [.2, 1]]},
            {"type": "box_area", "points": [[.3, .2], [.4, .2], [.4, .5], [.3, .5]]},
            {"type": "packing_route", "points": [[.7, .2], [.8, .2], [.8, .5], [.7, .5]]},
            {"type": "danger_zone", "points": [[0, 0], [.18, 0], [.18, 1], [0, 1]]},
        ]
        tracker = ZoneTracker(zones)
        tracker.update([{"id": 1, "class": "person", "center": [.35, .3]},
                        {"id": 12, "class": "item", "center": [.35, .3]}], 100)
        tracker.update([{"id": 1, "class": "person", "center": [.85, .3]},
                        {"id": 12, "class": "item", "center": [.85, .3]}], 101)
        self.assertIsNone(tracker.update([], 103))
        tracker.update([{"id": 1, "class": "person", "center": [.35, .3]},
                        {"id": 13, "class": "item", "center": [.35, .3]}], 110)
        tracker.update([{"id": 1, "class": "person", "center": [.1, .3]},
                        {"id": 13, "class": "item", "center": [.1, .3]}], 111)
        self.assertEqual(1, tracker.update([], 113)["item_count"])

    def test_three_second_event_window_keeps_its_playback_duration(self):
        frames = [(i / 5, None) for i in range(15)]
        self.assertAlmostEqual(5, clip_playback_fps(frames))
        self.assertAlmostEqual(3, len(frames) / clip_playback_fps(frames))

    def test_normalize_store(self):
        self.assertEqual("Aneka Jaya", normalize_store("SIP : AJ"))
        self.assertEqual("Aneka Jaya", normalize_store("ANEKA JAYA"))
        self.assertEqual("MJ", normalize_store("MJ"))
        self.assertEqual("MJ", normalize_store("SIP : MJ"))
        self.assertIsNone(normalize_store("LAIN-LAIN"))
        self.assertIsNone(normalize_store(None))

    def test_parse_qr_payload_thermal_multiline(self):
        payload = (
            "INVOICE: 121026-23\n"
            "CUSTOMER: ARI BOGOR\n"
            "ALAMAT: TOKO\n"
            "ASAL: SIP : AJ\n"
            "PETUGAS: RIDHO AL AMZAH"
        )
        res = parse_qr_payload(payload)
        self.assertIsNotNone(res)
        self.assertEqual("121026-23", res["field_one"])
        self.assertEqual("ARI BOGOR", res["field_two"])
        self.assertEqual("Aneka Jaya", res["field_three"])
        self.assertEqual(1.0, res["confidence"])
        self.assertTrue(res["raw_ocr"].startswith("QR: INVOICE: 121026-23"))

    def test_parse_qr_payload_delimiters(self):
        res = parse_qr_payload("121026-23 | TK HANSEL ASK | MJ")
        self.assertIsNotNone(res)
        self.assertEqual("121026-23", res["field_one"])
        self.assertEqual("TK HANSEL ASK", res["field_two"])
        self.assertEqual("MJ", res["field_three"])

    def test_parse_qr_payload_legacy_and_edge_cases(self):
        # Legacy single code
        res = parse_qr_payload("061026-23")
        self.assertIsNotNone(res)
        self.assertEqual("061026-23", res["field_one"])
        self.assertIsNone(res["field_two"])
        self.assertIsNone(res["field_three"])

        # URLs are ignored
        self.assertIsNone(parse_qr_payload("https://example.com/061026-23"))

        # Empty or non-matching
        self.assertIsNone(parse_qr_payload(""))
        self.assertIsNone(parse_qr_payload("BARCODE_12345"))

    def test_parse_qr_payload_mj_invoice(self):
        # Label DO untuk penjualan MJ memakai nomor invoice MJ apa adanya.
        res = parse_qr_payload("INVOICE: MJ-20261117-0005\nCUSTOMER: ALMIRA\nASAL: MJ\nPETUGAS: ADI")
        self.assertEqual("MJ-20261117-0005", res["field_one"])
        self.assertEqual("ALMIRA", res["field_two"])
        self.assertEqual("MJ", res["field_three"])
        self.assertIsNone(parse_qr_payload("INVOICE: 171126-105"))
        self.assertIsNone(parse_qr_payload("INVOICE: MJ-2026111-0005"))


if __name__ == "__main__":
    unittest.main()

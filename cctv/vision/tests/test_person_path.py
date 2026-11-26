import unittest

from logic import PersonPathTracker

ZONES = [
    {"type": "store_boundary", "points": [[0, 0], [0.7, 0], [0.7, 1], [0, 1]]},
    {"type": "box_area", "points": [[0.05, 0.1], [0.3, 0.1], [0.3, 0.4], [0.05, 0.4]]},
    {"type": "packing_route", "points": [[0.4, 0.6], [0.6, 0.6], [0.6, 0.9], [0.4, 0.9]]},
]


def person(foot_x, foot_y, height=0.3):
    return {"box": [foot_x - 0.05, foot_y - height, foot_x + 0.05, foot_y], "score": 0.8}


class PersonPathTrackerTest(unittest.TestCase):
    def walk(self, tracker, feet, start=0.0):
        events = []
        for i, foot in enumerate(feet):
            event = tracker.update([person(*foot)], now=start + i)
            if event:
                events.append(event)
        return events

    def test_from_box_area_out_of_store_without_packing_route_is_reported_once(self):
        tracker = PersonPathTracker(ZONES)
        events = self.walk(tracker, [(0.2, 0.35), (0.35, 0.4), (0.5, 0.45), (0.65, 0.45), (0.75, 0.45), (0.8, 0.45), (0.85, 0.45)])
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["detector"], "person")
        self.assertTrue(events[0]["exited_boundary"])
        self.assertFalse(events[0]["passed_packing_route"])
        self.assertIn("bukan barang", events[0]["reason"])

    def test_passing_the_packing_route_or_not_coming_from_box_area_is_not_reported(self):
        tracker = PersonPathTracker(ZONES)
        self.assertEqual(self.walk(tracker, [(0.2, 0.35), (0.45, 0.7), (0.65, 0.6), (0.75, 0.6), (0.8, 0.6)]), [])
        tracker = PersonPathTracker(ZONES)
        self.assertEqual(self.walk(tracker, [(0.5, 0.3), (0.65, 0.3), (0.75, 0.3), (0.8, 0.3)]), [])

    def test_single_jittery_point_outside_does_not_count_and_cooldown_limits_events(self):
        tracker = PersonPathTracker(ZONES, cooldown_seconds=120)
        self.assertEqual(self.walk(tracker, [(0.2, 0.35), (0.4, 0.4), (0.55, 0.4), (0.72, 0.4), (0.6, 0.4)]), [])
        self.assertEqual(len(self.walk(tracker, [(0.75, 0.4), (0.8, 0.4)], start=5)), 1)
        self.assertEqual(self.walk(tracker, [(0.2, 0.35), (0.4, 0.4), (0.55, 0.4), (0.75, 0.4), (0.8, 0.4)], start=20), [])

    def test_without_the_three_zones_nothing_is_tracked(self):
        tracker = PersonPathTracker(ZONES[:2])
        self.assertFalse(tracker.ready())
        self.assertIsNone(tracker.update([person(0.8, 0.4)], now=0))


if __name__ == "__main__":
    unittest.main()

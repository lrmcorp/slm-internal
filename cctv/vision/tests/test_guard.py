import os
import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import MagicMock

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from logic import people_in_zone
from person_detector import PersonDetector
from worker import Worker

FIXTURE = str(Path(__file__).parent / "fixtures" / "person.jpg")  # foto astronot NASA (domain publik)
LEFT_HALF = [[0.0, 0.0], [0.5, 0.0], [0.5, 1.0], [0.0, 1.0]]


class PeopleInZoneTest(unittest.TestCase):
    def test_counts_people_whose_feet_are_inside_the_zone(self):
        people = [
            {"box": [0.1, 0.2, 0.3, 0.9], "score": 0.9},   # kaki (0.2, 0.9) di kiri
            {"box": [0.6, 0.2, 0.8, 0.9], "score": 0.8},   # kaki di kanan
            {"box": [0.1, 0.1, 0.12, 0.12], "score": 0.9},  # terlalu kecil
        ]
        self.assertEqual([people[0]], people_in_zone(people, LEFT_HALF))
        self.assertEqual([], people_in_zone(people, None))
        self.assertEqual([], people_in_zone(people, [[0, 0], [1, 1]]))


class PersonDetectorTest(unittest.TestCase):
    def test_finds_the_person_in_a_photo_and_nothing_in_an_empty_frame(self):
        detector = PersonDetector()
        found = detector.detect(cv2.imread(FIXTURE))
        self.assertGreaterEqual(len(found), 1)
        self.assertGreater(found[0]["score"], 0.6)
        x1, y1, x2, y2 = found[0]["box"]
        self.assertLess(x1, 0.2)
        self.assertGreater(y2, 0.8)
        self.assertEqual([], detector.detect(np.full((360, 640, 3), 128, np.uint8)))


class GuardCheckTest(unittest.TestCase):
    def worker(self, people):
        worker = Worker.__new__(Worker)
        worker.camera_id = 1
        worker.shared = MagicMock()
        worker.shared.person.detect.return_value = people
        worker.guard = {"active": True, "zone": LEFT_HALF, "cooldown_seconds": 60}
        worker.guard_streak = 0
        worker.last_guard_alert = 0.0
        worker.post = MagicMock(return_value=MagicMock(status_code=201))
        return worker

    def test_needs_two_hits_in_a_row_then_waits_for_the_cooldown(self):
        frame = np.zeros((360, 640, 3), np.uint8)
        person = {"box": [0.1, 0.2, 0.3, 0.9], "score": 0.83}
        worker = self.worker([person])
        worker.check_guard(frame, 100.0)
        worker.post.assert_not_called()
        worker.check_guard(frame, 100.5)
        worker.post.assert_called_once()
        endpoint, kwargs = worker.post.call_args[0][0], worker.post.call_args[1]
        self.assertEqual("guard", endpoint)
        self.assertEqual(1, kwargs["data"]["person_count"])
        self.assertEqual(0.83, kwargs["data"]["confidence"])
        self.assertEqual("image/jpeg", kwargs["files"]["snapshot"][2])
        worker.check_guard(frame, 130.0)
        self.assertEqual(1, worker.post.call_count)
        worker.check_guard(frame, 161.0)
        self.assertEqual(2, worker.post.call_count)

    def test_a_miss_resets_the_streak_and_people_outside_the_zone_are_ignored(self):
        frame = np.zeros((360, 640, 3), np.uint8)
        inside = {"box": [0.1, 0.2, 0.3, 0.9], "score": 0.8}
        outside = {"box": [0.6, 0.2, 0.8, 0.9], "score": 0.9}
        worker = self.worker([inside])
        worker.check_guard(frame, 1.0)
        worker.shared.person.detect.return_value = [outside]
        worker.check_guard(frame, 1.5)
        worker.shared.person.detect.return_value = [inside]
        worker.check_guard(frame, 2.0)
        worker.post.assert_not_called()


if __name__ == "__main__":
    unittest.main()

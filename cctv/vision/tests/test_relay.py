import os
import unittest
from unittest import mock

from runtime import via_relay


class ViaRelayTest(unittest.TestCase):
    def test_hikvision_channel_goes_through_relay_without_credentials(self):
        with mock.patch.dict(os.environ, {"CCTV_RTSP_RELAY": "rtsp://go2rtc:8554/"}):
            self.assertEqual(via_relay("rtsp://dvr:p%40ss@100.118.114.23:8554/Streaming/Channels/1401"),
                             "rtsp://go2rtc:8554/ch1401")
            self.assertEqual(via_relay("rtsp://u:p@h:554/Streaming/Channels/1302?transportmode=unicast"),
                             "rtsp://go2rtc:8554/ch1302")

    def test_without_relay_or_unknown_path_the_original_is_kept(self):
        with mock.patch.dict(os.environ, {"CCTV_RTSP_RELAY": ""}):
            self.assertEqual(via_relay("rtsp://h/Streaming/Channels/1401"), "rtsp://h/Streaming/Channels/1401")
        with mock.patch.dict(os.environ, {"CCTV_RTSP_RELAY": "rtsp://go2rtc:8554"}):
            self.assertEqual(via_relay("rtsp://h/cam/realmonitor?channel=1"), "rtsp://h/cam/realmonitor?channel=1")
            self.assertEqual(via_relay("/data/video.mp4"), "/data/video.mp4")


if __name__ == "__main__":
    unittest.main()

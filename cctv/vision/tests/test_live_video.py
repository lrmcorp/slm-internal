import sys
import tempfile
import unittest
from pathlib import Path
import subprocess
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from live_video import LiveVideo

class LiveVideoTest(unittest.TestCase):
    def test_hls_encodes_playable_video_in_camera_private_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            writer=LiveVideo(directory,14,fps=5)
            for n in range(25):
                frame=np.random.default_rng(n).integers(0,256,(90,160,3),dtype=np.uint8)
                writer.write(frame)
            writer.close()
            folder=Path(directory)/'14'
            playlist=(folder/'stream.m3u8').read_text()
            self.assertIn('#EXTM3U',playlist)
            segments=list(folder.glob('segment*.ts'))
            self.assertGreater(len(segments),0)
            result=subprocess.run(['ffprobe','-v','error','-select_streams','v:0',
                '-show_entries','stream=codec_name,width,height','-of','json',str(segments[-1])],
                capture_output=True,text=True,check=True)
            self.assertIn('h264',result.stdout)
            self.assertIn('160',result.stdout)

    def test_direct_stream_produces_video_without_ai_frame_writes(self):
        import json
        import time
        from unittest.mock import patch
        real_popen = subprocess.Popen
        with tempfile.TemporaryDirectory() as directory:
            source = str(Path(directory) / 'source.mp4')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i',
                'testsrc2=size=160x90:rate=15', '-t', '4', '-c:v', 'libx264',
                '-g', '15', source], check=True)
            writer = LiveVideo(directory, 14, fps=15, source='rtsp://example/Streaming/Channels/1401')
            writer.selected_source = source
            writer.codec = 'h264'
            def local_input(command, **kwargs):
                # Fixture substitutes file transport; the real output pipeline runs.
                command = list(command)
                for option in ('-rtsp_transport', '-timeout'):
                    index = command.index(option)
                    del command[index:index + 2]
                return real_popen(command, **kwargs)
            with patch('live_video.subprocess.Popen', side_effect=local_input):
                writer.ensure_running()
                writer.process.wait(timeout=15)
            folder = Path(directory) / '14'
            self.assertTrue((folder / 'stream.m3u8').exists())
            segment = sorted(folder.glob('segment*.ts'))[-1]
            probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                '-show_entries', 'stream=codec_name,r_frame_rate', '-of', 'json', str(segment)],
                capture_output=True, text=True, check=True)
            stream = json.loads(probe.stdout)['streams'][0]
            self.assertEqual(stream['codec_name'], 'h264')
            self.assertEqual(stream['r_frame_rate'], '15/1')
            writer.close()
            # Exercise the actual browser-compatible encoding/filter branch too.
            writer.codec = 'hevc'
            writer.retry_at = 0
            with patch('live_video.subprocess.Popen', side_effect=local_input):
                writer.ensure_running()
                writer.process.wait(timeout=15)
            segment = sorted(folder.glob('segment*.ts'))[-1]
            result = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
                '-show_entries', 'stream=codec_name,r_frame_rate', '-of', 'json', str(segment)],
                capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(result.stdout)['streams'][0]['r_frame_rate'], '15/1')
            writer.close()

    def test_h265_live_feed_is_encoded_for_browser_with_bounded_cpu(self):
        from unittest.mock import patch, Mock
        import json
        with tempfile.TemporaryDirectory() as directory:
            writer = LiveVideo(directory, 13, fps=15, source='rtsp://example/Streaming/Channels/1301')
            probe = Mock(stdout=json.dumps({'streams': [{'codec_name': 'hevc'}]}).encode())
            process = Mock()
            process.poll.return_value = None
            with patch('live_video.subprocess.run', return_value=probe) as run, \
                 patch('live_video.subprocess.Popen', return_value=process) as start:
                writer.ensure_running()
                command = start.call_args.args[0]
                self.assertIn('libx264', command)
                self.assertEqual(command[command.index('-threads') + 1], '1')
                self.assertEqual(command[command.index('-i') + 1], 'rtsp://example/Streaming/Channels/1302')
                writer.ensure_running()
                self.assertEqual(start.call_count, 1)
                self.assertEqual(run.call_count, 1)
            writer.close()

    def test_unavailable_substream_falls_back_to_main_and_dead_process_is_reprobed(self):
        from unittest.mock import patch, Mock
        import json
        with tempfile.TemporaryDirectory() as directory:
            writer = LiveVideo(directory, 14, fps=15, source='rtsp://example/Streaming/Channels/1401')
            probe = Mock(stdout=json.dumps({'streams': [{'codec_name': 'h264'}]}).encode())
            process = Mock()
            process.poll.return_value = None
            with patch('live_video.subprocess.run', side_effect=[subprocess.TimeoutExpired('ffprobe',8),probe,probe]) as run, \
                 patch('live_video.subprocess.Popen', return_value=process):
                writer.ensure_running()
                self.assertEqual(writer.selected_source, writer.source)
                process.poll.return_value = 1
                writer.retry_at = 0
                writer.ensure_running()
                self.assertEqual(run.call_count, 3)
                self.assertTrue(writer.selected_source.endswith('1402'))
            writer.close()

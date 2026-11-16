"""Optional authenticated HLS output; encoded locally, never a public RTSP URL."""
from pathlib import Path
import os
import subprocess
import json
import re
import time


class LiveVideo:
    def __init__(self, directory, camera_id, fps=3, source=None):
        self.directory = Path(directory) / str(camera_id)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.fps = fps
        self.process = None
        self.shape = None
        self.source = source
        self.selected_source = None
        self.codec = None
        self.retry_at = 0

    def ensure_running(self):
        """Independent RTSP process; QR/inference never supplies its frames."""
        if not self.source or (self.process and self.process.poll() is None):
            return
        if time.monotonic() < self.retry_at:
            return
        self.retry_at = time.monotonic() + 10
        if self.process and self.process.poll() is not None:
            self.selected_source = None
            self.codec = None
        self.close()
        if self.selected_source is None:
            candidates = [self.source]
            # Hikvision sub-stream is only used for viewing, never QR/evidence.
            if os.getenv('CCTV_LIVE_USE_SUBSTREAM', 'true').lower() == 'true':
                substream = re.sub(r'(/Streaming/Channels/[0-9]+)01$', r'\g<1>02', self.source)
                if substream != self.source:
                    candidates.insert(0, substream)
            for candidate in candidates:
                try:
                    probe = subprocess.run([
                        'ffprobe', '-v', 'error', '-rtsp_transport', 'tcp',
                        '-timeout', '5000000', '-select_streams', 'v:0',
                        '-show_entries', 'stream=codec_name', '-of', 'json', candidate,
                    ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=8, check=True)
                    streams = json.loads(probe.stdout).get('streams', [])
                    if streams:
                        self.selected_source = candidate
                        self.codec = streams[0].get('codec_name')
                        break
                except (OSError, subprocess.SubprocessError, ValueError):
                    continue
            if self.selected_source is None:
                self.retry_at = time.monotonic() + 10
                return
        self._clean_playlist()
        command = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                   '-rtsp_transport', 'tcp', '-timeout', '10000000',
                   '-i', self.selected_source, '-map', '0:v:0', '-an']
        if self.codec == 'h264':
            # Remux preserves DVR frame rate without decoding or AI throttling.
            command += ['-c:v', 'copy']
        else:
            # H.265 DVR feeds need H.264 for browser compatibility.
            width = max(160, min(1920, int(os.getenv('CCTV_LIVE_MAX_WIDTH', '960'))))
            crf = os.getenv('CCTV_LIVE_CRF', '22')
            command += ['-vf', f"scale=w='min({width},iw)':h=-2,fps={self.fps},pad=ceil(iw/2)*2:ceil(ih/2)*2",
                        '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast',
                        '-crf', str(crf),
                        '-tune', 'zerolatency', '-pix_fmt', 'yuv420p',
                        '-g', str(round(self.fps)), '-sc_threshold', '0']
        command += ['-f', 'hls', '-hls_time', '2', '-hls_list_size', '5',
                    '-hls_flags', 'delete_segments+temp_file+omit_endlist',
                    '-hls_delete_threshold', '2',
                    '-hls_segment_filename', str(self.directory / 'segment%06d.ts'),
                    str(self.directory / 'stream.m3u8')]
        try:
            self.process = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            self.process = None
        # Reprobe on a subsequent failure, including fallback to main-stream.
        if self.process is None:
            self.selected_source = None

    def _clean_playlist(self):
        for file in self.directory.glob('segment*.ts'):
            file.unlink(missing_ok=True)
        (self.directory / 'stream.m3u8').unlink(missing_ok=True)

    def write(self, frame):
        height, width = frame.shape[:2]
        if self.process is None or self.process.poll() is not None or self.shape != (width, height):
            self.close()
            # Reconnect begins a fresh playlist. Only remove this camera's HLS files.
            self._clean_playlist()
            self.shape = (width, height)
            self.process = subprocess.Popen([
                'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                '-f', 'rawvideo', '-pixel_format', 'bgr24', '-video_size', f'{width}x{height}',
                '-framerate', str(self.fps), '-i', 'pipe:0', '-an',
                '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
                '-pix_fmt', 'yuv420p', '-g', str(max(1, round(self.fps))), '-sc_threshold', '0',
                '-f', 'hls', '-hls_time', '2', '-hls_list_size', '5',
                '-hls_flags', 'delete_segments+temp_file', '-hls_delete_threshold', '2',
                '-hls_segment_filename', str(self.directory / 'segment%06d.ts'),
                str(self.directory / 'stream.m3u8'),
            ], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            self.process.stdin.write(frame.tobytes())
            self.process.stdin.flush()
        except (BrokenPipeError, OSError):
            self.close()

    def close(self):
        if self.process is None:
            return
        if self.source:
            self.process.terminate()
        elif self.process.stdin:
            try:
                self.process.stdin.close()
            except OSError:
                pass
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()
        self.process = None

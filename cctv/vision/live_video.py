"""Optional authenticated HLS output; encoded locally, never a public RTSP URL.

Live hanya berjalan selama ada yang menonton (penanda `.viewer` disentuh backend tiap kali
playlist/segmen diminta), supaya bandwidth dari DVR toko tidak terpakai 24 jam.
"""
from pathlib import Path
import os
import re
import ipaddress
import shutil
import socket
import subprocess
import json
import time
from urllib.parse import urlsplit, urlunsplit


def _ffmpeg_binary() -> str:
    found = shutil.which('ffmpeg')
    if found:
        return found
    try:  # image ramping: ffmpeg statis dari paket imageio-ffmpeg, tanpa paket ffmpeg Debian
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return 'ffmpeg'


FFMPEG = _ffmpeg_binary()
FFPROBE = shutil.which('ffprobe')
_VIDEO_CODEC = re.compile(r'Stream #\S+.*?Video:\s*([A-Za-z0-9_]+)')


def with_resolved_host(url: str) -> str:
    """Ganti nama host dengan alamat IP sebelum diberikan ke ffmpeg.

    ffmpeg statis (glibc) bisa crash saat mencari nama host sendiri; alamat IP aman.
    Bila nama tidak bisa dicari, URL dikembalikan apa adanya.
    """
    try:
        parts = urlsplit(url)
        host = parts.hostname
        if not host:
            return url
        try:
            ipaddress.ip_address(host)
            return url
        except ValueError:
            pass
        address = socket.gethostbyname(host)
        netloc = parts.netloc
        userinfo, _, hostport = netloc.rpartition('@')
        hostport = hostport.replace(host, address, 1)
        return urlunsplit((parts.scheme, f'{userinfo}@{hostport}' if userinfo else hostport,
                           parts.path, parts.query, parts.fragment))
    except (OSError, ValueError):
        return url


def segment_seconds() -> str:
    """Panjang segmen HLS. Lebih pendek = lebih realtime; DVR tetap membatasi lewat jarak keyframe."""
    value = float(os.getenv('CCTV_LIVE_SEGMENT_SECONDS', '1'))
    return f'{max(0.5, min(4.0, value)):g}'


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
        self.viewer_marker = self.directory / '.viewer'

    def viewer_active(self, idle_seconds: float) -> bool:
        """True bila backend mencatat ada penonton dalam `idle_seconds` terakhir."""
        try:
            return time.time() - self.viewer_marker.stat().st_mtime <= idle_seconds
        except OSError:
            return False

    def running(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def stop_if_idle(self, idle_seconds: float) -> bool:
        """Hentikan encoder live bila tidak ada yang menonton. True bila dihentikan."""
        if self.source and self.running() and not self.viewer_active(idle_seconds):
            self.close()
            self._clean_playlist()
            return True
        return False

    def _probe(self, candidate):
        """Codec video sumber, atau None bila tidak bisa dibuka."""
        if FFPROBE:
            probe = subprocess.run([
                FFPROBE, '-v', 'error', '-rtsp_transport', 'tcp',
                '-timeout', '5000000', '-select_streams', 'v:0',
                '-show_entries', 'stream=codec_name', '-of', 'json', candidate,
            ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=8, check=True)
            streams = json.loads(probe.stdout).get('streams', [])
            return streams[0].get('codec_name') if streams else None
        # Tanpa ffprobe: ffmpeg mencetak info stream ke stderr lalu keluar karena tidak ada output.
        probe = subprocess.run([FFMPEG, '-hide_banner', '-rtsp_transport', 'tcp', '-timeout', '5000000',
                                '-i', with_resolved_host(candidate)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=8)
        match = _VIDEO_CODEC.search(probe.stderr.decode(errors='replace'))
        return match.group(1) if match else None

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
                    codec = self._probe(candidate)
                    if codec:
                        self.selected_source = candidate
                        self.codec = codec
                        break
                except (OSError, subprocess.SubprocessError, ValueError):
                    continue
            if self.selected_source is None:
                self.retry_at = time.monotonic() + 10
                return
        self._clean_playlist()
        command = [FFMPEG, '-hide_banner', '-loglevel', 'error', '-y',
                   '-rtsp_transport', 'tcp', '-timeout', '10000000',
                   '-i', with_resolved_host(self.selected_source), '-map', '0:v:0', '-an']
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
        command += ['-f', 'hls', '-hls_time', segment_seconds(), '-hls_list_size', '4',
                    '-hls_flags', 'delete_segments+temp_file+omit_endlist+independent_segments',
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
                FFMPEG, '-hide_banner', '-loglevel', 'error', '-y',
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

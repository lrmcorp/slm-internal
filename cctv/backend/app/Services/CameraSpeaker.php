<?php

namespace App\Services;

use App\Models\Camera;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Memutar suara di speaker kamera lewat two-way audio Hikvision (ISAPI):
 * buka sesi, kirim G.711 µ-law dengan kecepatan putar asli, lalu tutup sesi.
 * Alamat dan login ada di environment, sama seperti alamat RTSP: CCTV_CAMERA_14_SPEAKER_URL=http://user:pass@host:port
 */
class CameraSpeaker
{
    /** Hening di awal (bawaan 0,8 detik): speaker/DVR yang baru menyala sering tersendat sebentar; kalimat mulai setelahnya. */
    public static function leadIn(): string
    {
        $ms = max(0, min(3000, (int) config('cctv.speaker_lead_in_ms', 800)));
        return str_repeat("\xFF", intdiv($ms * TextToSpeech::SAMPLE_RATE, 1000));
    }

    public function __construct(private IsapiTalkSocket $talk) {}

    public static function envKey(Camera $camera): string
    {
        $base = (string) ($camera->stream_env_key ?: 'CCTV_CAMERA_'.$camera->id.'_URL');
        return preg_replace('/_URL$/', '', $base).'_SPEAKER_URL';
    }

    /** @return array{base:string,user:string,pass:string}|null */
    public static function endpoint(Camera $camera): ?array
    {
        $raw = getenv(self::envKey($camera)) ?: ($_ENV[self::envKey($camera)] ?? '');
        $parts = $raw ? parse_url((string) $raw) : false;
        if (!$parts || empty($parts['host'])) {
            return null;
        }
        $scheme = $parts['scheme'] ?? 'http';
        $port = isset($parts['port']) ? ':'.$parts['port'] : '';
        return ['base' => "{$scheme}://{$parts['host']}{$port}", 'user' => rawurldecode($parts['user'] ?? ''), 'pass' => rawurldecode($parts['pass'] ?? '')];
    }

    public function play(Camera $camera, string $ulaw): void
    {
        $endpoint = self::endpoint($camera) ?? throw new RuntimeException(self::envKey($camera).' belum diisi di cctv/.env.');
        $channel = max(1, (int) ($camera->speaker_channel ?: 1));
        $path = "/ISAPI/System/TwoWayAudio/channels/{$channel}";
        $client = fn (int $timeout) => Http::timeout($timeout)->withDigestAuth($endpoint['user'], $endpoint['pass'])->baseUrl($endpoint['base']);

        // Sesi lama (mis. dari aplikasi) membuat open ditolak; tutup dulu, abaikan hasilnya.
        $this->closeQuietly($client, $path);
        $open = $client(5)->withBody('', 'application/xml')->put("{$path}/open");
        if (!$open->successful()) {
            throw new RuntimeException("Speaker menolak membuka sesi (HTTP {$open->status()}). Periksa login, kanal {$channel}, dan fitur two-way audio.");
        }
        // Seperti aplikasi Hikvision dan go2rtc: audioData tanpa sessionId, suara mentah lewat sambungan yang sama.
        try {
            $this->talk->stream($endpoint['base'], $endpoint['user'], $endpoint['pass'], "{$path}/audioData", self::leadIn().$ulaw, TextToSpeech::SAMPLE_RATE);
        } finally {
            $this->closeQuietly($client, $path);
        }
    }

    /** Tutup sesi; DVR yang lambat menjawab tidak boleh membuat suara yang sudah diputar dianggap gagal. */
    private function closeQuietly(\Closure $client, string $path): void
    {
        try {
            $client(5)->withBody('', 'application/xml')->put("{$path}/close");
        } catch (\Throwable) {
        }
    }

    /** Status two-way audio di kamera (untuk pemeriksaan pemasangan). */
    public function describe(Camera $camera): string
    {
        $endpoint = self::endpoint($camera) ?? throw new RuntimeException(self::envKey($camera).' belum diisi di cctv/.env.');
        $response = Http::timeout(8)->withDigestAuth($endpoint['user'], $endpoint['pass'])->baseUrl($endpoint['base'])
            ->get('/ISAPI/System/TwoWayAudio/channels');
        if (!$response->successful()) {
            throw new RuntimeException("Speaker tidak menjawab (HTTP {$response->status()}).");
        }
        return $response->body();
    }
}

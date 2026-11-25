<?php

namespace App\Services;

use App\Models\Camera;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * Memutar suara di speaker kamera lewat two-way audio Hikvision (ISAPI):
 * buka sesi, kirim G.711 µ-law dengan kecepatan putar asli, lalu tutup sesi.
 * Alamat dan login ada di environment, sama seperti alamat RTSP: CCTV_CAMERA_14_SPEAKER_URL=http://user:pass@host:port
 */
class CameraSpeaker
{
    /** 0,3 detik hening di awal supaya suku kata pertama tidak terpotong saat speaker baru menyala. */
    private const LEAD_IN = 2400;

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
        $client(5)->withBody('', 'application/xml')->put("{$path}/close");
        $open = $client(5)->withBody('', 'application/xml')->put("{$path}/open");
        if (!$open->successful()) {
            throw new RuntimeException("Speaker menolak membuka sesi (HTTP {$open->status()}). Periksa login, kanal {$channel}, dan fitur two-way audio.");
        }
        $session = preg_match('/<sessionId>([^<]+)<\/sessionId>/', $open->body(), $m) ? $m[1] : null;

        $audio = str_repeat("\xFF", self::LEAD_IN).$ulaw;
        $stream = self::paced($audio);
        try {
            $sent = $client((int) ceil(strlen($audio) / TextToSpeech::SAMPLE_RATE) + 4)
                ->withBody($stream, 'application/octet-stream')
                // Panjang tetap (bukan chunked): speaker membaca soket apa adanya, potongan chunked jadi bunyi derau.
                ->withOptions(['curl' => [
                    CURLOPT_INFILESIZE => $stream->length(),
                    CURLOPT_HTTPHEADER => ['Content-Type: application/octet-stream', 'Expect:'],
                ]])
                ->put("{$path}/audioData".($session ? '?sessionId='.rawurlencode($session) : ''));
            if (!$sent->successful()) {
                throw new RuntimeException("Speaker menolak suara (HTTP {$sent->status()}).");
            }
        } catch (ConnectionException $e) {
            // DVR Hikvision tidak menjawab audioData selama sesi masih terbuka; habis waktu setelah semua suara
            // terkirim berarti suara sudah diputar. Yang gagal hanya bila suara belum habis terkirim.
            if (!$stream->eof()) {
                throw $e;
            }
        } finally {
            $client(5)->withBody('', 'application/xml')->put("{$path}/close".($session ? '?sessionId='.rawurlencode($session) : ''));
        }
    }

    public static function paced(string $audio): PacedAudioStream
    {
        return new PacedAudioStream($audio, TextToSpeech::SAMPLE_RATE);
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

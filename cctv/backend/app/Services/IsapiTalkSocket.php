<?php

namespace App\Services;

use RuntimeException;

/**
 * Jalur suara two-way audio Hikvision seperti aplikasinya (dan go2rtc): PUT audioData dengan Content-Length 0,
 * DVR menjawab dan membiarkan sambungan terbuka, lalu G.711 mentah dikirim lewat sambungan itu dengan kecepatan putar.
 * Login Digest dihitung sendiri karena isi suara tidak lewat klien HTTP biasa.
 */
class IsapiTalkSocket
{
    /** 20 ms per potongan, sama dengan paket RTP G.711. */
    private const CHUNK = 160;
    /** Bawaan suara yang dikirim di depan (ms) supaya penyangga DVR tidak kosong saat jaringan tersendat. */
    private const PREFILL_MS = 600;

    public function __construct(private ?int $prefillMs = null) {}

    public function stream(string $base, string $user, string $pass, string $uri, string $audio, int $bytesPerSecond = 8000): void
    {
        $parts = parse_url($base);
        $host = (string) ($parts['host'] ?? '');
        $port = (int) ($parts['port'] ?? 80);
        $authorization = null;

        for ($attempt = 0; $attempt < 2; $attempt++) {
            $socket = $this->connect($host, $port);
            fwrite($socket, $this->request($host, $port, $uri, $authorization));
            [$status, $headers] = $this->readHead($socket, 5);

            if ($status === 401 && $authorization === null) {
                fclose($socket);
                $authorization = self::digest($headers['www-authenticate'] ?? '', $user, $pass, 'PUT', $uri);
                continue;
            }
            if ($status !== null && ($status < 200 || $status >= 300)) {
                fclose($socket);
                throw new RuntimeException("Speaker menolak suara (HTTP {$status}).");
            }
            // Tanpa jawaban dalam 5 detik suara tetap dikirim: sebagian DVR baru menjawab setelah sesi ditutup.
            try {
                $this->pace($socket, $audio, $bytesPerSecond);
                usleep(300_000);
            } finally {
                fclose($socket);
            }
            return;
        }
        throw new RuntimeException('Speaker menolak login (HTTP 401). Periksa user dan password di alamat speaker.');
    }

    /** Header Authorization Digest (MD5, qop auth atau tanpa qop) dari tantangan WWW-Authenticate. */
    public static function digest(string $challenge, string $user, string $pass, string $method, string $uri, ?string $cnonce = null): string
    {
        if (stripos($challenge, 'Digest') !== 0) {
            throw new RuntimeException('Speaker meminta login yang tidak didukung: '.($challenge ?: 'tanpa keterangan').'.');
        }
        preg_match_all('/(\w+)=(?:"([^"]*)"|([^,\s]*))/', substr($challenge, 6), $m, PREG_SET_ORDER);
        $p = [];
        foreach ($m as $pair) {
            $p[strtolower($pair[1])] = $pair[2] !== '' ? $pair[2] : ($pair[3] ?? '');
        }
        $realm = $p['realm'] ?? '';
        $nonce = $p['nonce'] ?? '';
        $ha1 = md5("{$user}:{$realm}:{$pass}");
        $ha2 = md5("{$method}:{$uri}");
        $header = sprintf('Digest username="%s", realm="%s", nonce="%s", uri="%s"', $user, $realm, $nonce, $uri);
        $qops = array_map('trim', explode(',', $p['qop'] ?? ''));
        if (in_array('auth', $qops, true)) {
            $nc = '00000001';
            $cnonce ??= bin2hex(random_bytes(8));
            $header .= sprintf(', qop=auth, nc=%s, cnonce="%s", response="%s"', $nc, $cnonce, md5("{$ha1}:{$nonce}:{$nc}:{$cnonce}:auth:{$ha2}"));
        } else {
            $header .= sprintf(', response="%s"', md5("{$ha1}:{$nonce}:{$ha2}"));
        }
        if (isset($p['opaque'])) {
            $header .= sprintf(', opaque="%s"', $p['opaque']);
        }
        if (isset($p['algorithm'])) {
            $header .= ', algorithm='.$p['algorithm'];
        }
        return $header;
    }

    /** @return resource */
    private function connect(string $host, int $port)
    {
        $socket = @stream_socket_client("tcp://{$host}:{$port}", $errno, $error, 5);
        if (!$socket) {
            throw new RuntimeException("Speaker tidak bisa dihubungi ({$host}:{$port}): {$error}");
        }
        stream_set_timeout($socket, 5);
        return $socket;
    }

    private function request(string $host, int $port, string $uri, ?string $authorization): string
    {
        $lines = [
            "PUT {$uri} HTTP/1.1",
            'Host: '.($port === 80 ? $host : "{$host}:{$port}"),
            'Content-Type: application/octet-stream',
            'Content-Length: 0',
            'Connection: keep-alive',
        ];
        if ($authorization !== null) {
            $lines[] = "Authorization: {$authorization}";
        }
        return implode("\r\n", $lines)."\r\n\r\n";
    }

    /** @return array{0:?int,1:array<string,string>} status null bila tidak ada jawaban dalam batas waktu. */
    private function readHead($socket, int $timeout): array
    {
        stream_set_timeout($socket, $timeout);
        $line = fgets($socket);
        if ($line === false || !preg_match('#^HTTP/\d(?:\.\d)?\s+(\d{3})#', $line, $m)) {
            return [null, []];
        }
        $headers = [];
        while (($line = fgets($socket)) !== false && trim($line) !== '') {
            [$name, $value] = array_pad(explode(':', $line, 2), 2, '');
            $headers[strtolower(trim($name))] = trim($value);
        }
        return [(int) $m[1], $headers];
    }

    private function pace($socket, string $audio, int $bytesPerSecond): void
    {
        stream_set_timeout($socket, 5);
        $started = microtime(true);
        $length = strlen($audio);
        $prefillMs = $this->prefillMs ?? (int) (function_exists('config') ? config('cctv.speaker_prefill_ms', self::PREFILL_MS) : self::PREFILL_MS);
        $prefill = intdiv(max(0, $prefillMs) * $bytesPerSecond, 1000 * self::CHUNK);
        for ($offset = 0, $index = 0; $offset < $length; $offset += self::CHUNK, $index++) {
            $due = $started + max(0, $index - $prefill) * self::CHUNK / $bytesPerSecond;
            $wait = $due - microtime(true);
            if ($wait > 0) {
                usleep((int) ($wait * 1_000_000));
            }
            $piece = substr($audio, $offset, self::CHUNK);
            if (@fwrite($socket, $piece) !== strlen($piece)) {
                throw new RuntimeException('Sambungan ke speaker terputus saat suara dikirim.');
            }
        }
    }
}

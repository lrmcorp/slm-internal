<?php

namespace App\Services;

use Psr\Http\Message\StreamInterface;
use RuntimeException;

/**
 * Isi permintaan yang dikirim seperti diputar: paling banyak satu potongan (0,1 detik) per baca, dan baru
 * diberikan saat waktunya, sedikit di depan. Speaker kamera punya penyangga kecil; kiriman sekaligus terpotong.
 * Bisa diulang dari awal (rewind) bila curl mengirim ulang setelah tantangan Digest.
 * Ukurannya sengaja tidak diumumkan (getSize null): Guzzle mengirim isi di bawah 1 MB sekaligus sebagai string bila
 * ukurannya diketahui. Content-Length diberikan lewat CURLOPT_INFILESIZE di CameraSpeaker.
 */
class PacedAudioStream implements StreamInterface
{
    private int $offset = 0;
    private ?float $started = null;

    public function __construct(private string $audio, private int $bytesPerSecond = 8000, private int $chunk = 800, private float $lead = 0.25) {}

    public function read(int $length): string
    {
        if ($this->eof()) {
            return '';
        }
        $this->started ??= microtime(true);
        $wait = $this->started + $this->offset / $this->bytesPerSecond - $this->lead - microtime(true);
        if ($wait > 0) {
            usleep((int) ($wait * 1_000_000));
        }
        $piece = substr($this->audio, $this->offset, min($length, $this->chunk));
        $this->offset += strlen($piece);
        return $piece;
    }

    public function eof(): bool { return $this->offset >= strlen($this->audio); }
    public function getSize(): ?int { return null; }
    public function length(): int { return strlen($this->audio); }
    public function tell(): int { return $this->offset; }
    public function isSeekable(): bool { return true; }
    public function isReadable(): bool { return true; }
    public function isWritable(): bool { return false; }
    public function rewind(): void { $this->seek(0); }

    public function seek(int $offset, int $whence = SEEK_SET): void
    {
        if ($whence !== SEEK_SET || $offset < 0 || $offset > strlen($this->audio)) {
            throw new RuntimeException('Hanya bisa diulang dari posisi tertentu.');
        }
        $this->offset = $offset;
        $this->started = null;
    }

    public function getContents(): string
    {
        $rest = '';
        while (!$this->eof()) {
            $rest .= $this->read($this->chunk);
        }
        return $rest;
    }

    public function __toString(): string
    {
        return $this->audio;
    }

    public function close(): void {}
    public function detach() { return null; }
    public function write(string $string): int { throw new RuntimeException('Tidak bisa ditulis.'); }
    public function getMetadata(?string $key = null) { return $key === null ? [] : null; }
}

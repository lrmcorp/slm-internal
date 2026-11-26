<?php

namespace App\Jobs;

use App\Models\Camera;
use App\Services\CameraSpeaker;
use App\Services\TextToSpeech;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Pengumuman dari SLM (laporan pesanan atau teks bebas dari Owner) di speaker kamera. Suara dibuat sekali,
 * lalu diputar bergantian di tiap kanal two-way audio yang dipilih (DVR hanya membuka satu sesi bicara
 * sekaligus). Kanal yang gagal dicatat dan tidak menghentikan kanal lain.
 */
class SpeakAnnouncement implements ShouldQueue
{
    use Queueable;

    public int $tries = 2;
    public int $timeout = 600;
    public int $backoff = 20;

    /** @var list<int> */
    public array $channels;

    /** @param int|list<int> $channels */
    public function __construct(public int $cameraId, public string $text, int|array $channels)
    {
        $this->channels = array_values(array_unique(array_map('intval', (array) $channels)));
    }

    public function handle(TextToSpeech $tts, CameraSpeaker $speaker): void
    {
        $camera = Camera::find($this->cameraId);
        if (!$camera) {
            Log::warning("Pengumuman SLM dilewati: kamera #{$this->cameraId} tidak ada");
            return;
        }
        $audio = $tts->ulaw($this->text);
        $failed = [];
        foreach ($this->channels as $channel) {
            // Hanya untuk pemutaran ini; pengaturan kanal kamera tidak berubah.
            $camera->speaker_channel = $channel;
            try {
                $speaker->play($camera, $audio);
                Log::info("Pengumuman SLM diputar di kamera #{$camera->id}, kanal {$channel}");
            } catch (\Throwable $e) {
                $failed[] = $channel;
                Log::warning("Pengumuman SLM gagal di kanal {$channel}: ".$e->getMessage());
            }
        }
        if ($failed && count($failed) === count($this->channels)) {
            throw new RuntimeException('Pengumuman gagal di semua kanal: '.implode(', ', $failed));
        }
    }
}

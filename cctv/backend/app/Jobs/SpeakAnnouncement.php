<?php

namespace App\Jobs;

use App\Models\Camera;
use App\Services\CameraSpeaker;
use App\Services\TextToSpeech;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/** Pengumuman dari SLM (mis. pesanan yang belum diproses) di speaker kamera, kanal two-way audio tertentu. */
class SpeakAnnouncement implements ShouldQueue
{
    use Queueable;

    public int $tries = 2;
    public int $timeout = 120;
    public int $backoff = 20;

    public function __construct(public int $cameraId, public string $text, public int $channel) {}

    public function handle(TextToSpeech $tts, CameraSpeaker $speaker): void
    {
        $camera = Camera::find($this->cameraId);
        if (!$camera) {
            Log::warning("Pengumuman SLM dilewati: kamera #{$this->cameraId} tidak ada");
            return;
        }
        // Hanya untuk pemutaran ini; pengaturan kanal kamera tidak berubah.
        $camera->speaker_channel = $this->channel;
        $speaker->play($camera, $tts->ulaw($this->text));
        Log::info("Pengumuman SLM diputar di kamera #{$camera->id}, kanal {$this->channel}");
    }
}

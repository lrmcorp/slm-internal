<?php

namespace App\Jobs;

use App\Models\Camera;
use App\Models\Incident;
use App\Services\CameraSpeaker;
use App\Services\GuardSchedule;
use App\Services\TextToSpeech;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/** Putar kalimat peringatan di speaker kamera. Gagal dicatat di kejadian, tidak diulang (peringatan basi tidak berguna). */
class SpeakGuardWarning implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;
    public int $timeout = 80;

    public function __construct(public int $cameraId, public ?int $incidentId = null, public ?string $text = null) {}

    public function handle(TextToSpeech $tts, CameraSpeaker $speaker): void
    {
        $camera = Camera::find($this->cameraId);
        if (!$camera) {
            return;
        }
        $incident = $this->incidentId ? Incident::find($this->incidentId) : null;
        // Kejadian yang sudah lebih dari 2 menit tidak diumumkan lagi (mis. antrean sempat macet).
        if ($incident && $incident->occurred_at->lt(now()->subMinutes(2))) {
            return;
        }
        $status = 'spoken';
        try {
            $speaker->play($camera, $tts->ulaw($this->text ?? GuardSchedule::message($camera)));
        } catch (\Throwable $e) {
            $status = 'failed: '.$e->getMessage();
            Log::warning("Peringatan suara kamera #{$camera->id} gagal: ".$e->getMessage());
            if (!$incident) {
                throw $e;
            }
        }
        if ($incident) {
            $incident->update(['metadata' => array_merge((array) $incident->metadata, ['speaker' => $status])]);
        }
    }
}

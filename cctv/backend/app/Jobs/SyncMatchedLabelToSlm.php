<?php

namespace App\Jobs;

use App\Models\LabelRecord;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class SyncMatchedLabelToSlm implements ShouldQueue, ShouldBeUnique
{
    use Queueable;

    public int $tries = 5;
    public int $uniqueFor = 1800;
    public function uniqueId(): string { return (string) $this->labelId; }
    public int $timeout = 45;

    public function __construct(public int $labelId) {}

    public function backoff(): array
    {
        return [10, 30, 120, 300];
    }

    public static function fingerprint(LabelRecord $label): string
    {
        return hash('sha256', json_encode([
            $label->field_one, $label->field_two, $label->field_three,
            $label->slm_reference, $label->first_seen_at?->toIso8601String(), config('app.url'),
            $label->packing_completed_at?->toIso8601String(),
        ], JSON_UNESCAPED_UNICODE));
    }

    public function handle(): void
    {
        $label = LabelRecord::findOrFail($this->labelId);
        if ($label->slm_status !== 'matched' || !in_array($label->review_status, ['auto_verified', 'auto_read', 'confirmed'], true)) {
            $label->update(['slm_sync_status' => 'not_ready']);
            return;
        }

        $minConfidence = (float) config('cctv.min_confidence', 0.90);
        if ($label->review_status !== 'confirmed' && (float) $label->confidence < $minConfidence) {
            $label->update(['slm_sync_status' => 'not_ready']);
            return;
        }

        $hash = self::fingerprint($label);
        if ($label->slm_sync_status === 'synced' && $label->slm_synced_hash === $hash) {
            return;
        }

        $base = config('cctv.slm_base_url');
        $path = config('cctv.slm_sync_path');
        $token = config('cctv.slm_token');
        $appUrl = rtrim(config('app.url'), '/');
        $isAllowedBase = $base && (
            str_starts_with($base, 'https://')
            || app()->environment('local', 'testing')
            || str_starts_with($base, 'http://localhost')
            || str_starts_with($base, 'http://127.0.0.1')
        );
        $isAllowedAppUrl = $appUrl && (
            str_starts_with($appUrl, 'https://')
            || str_starts_with($appUrl, 'http://')
            || app()->environment('local', 'testing')
            || str_starts_with($appUrl, 'http://localhost')
            || str_starts_with($appUrl, 'http://127.0.0.1')
        );
        if (!$base || !$isAllowedBase || !$path || !$token || !$isAllowedAppUrl) {
            $label->update(['slm_sync_status' => 'pending_configuration']);
            return;
        }

        $disk = Storage::disk('local');
        if (!$label->evidence_path || !$disk->exists($label->evidence_path)) {
            $label->update(['slm_sync_status' => 'missing_photo',
                'slm_sync_error' => 'Gambar bukti label tidak ditemukan di penyimpanan privat.']);
            return;
        }

        $photoEvidenceUrl = url("/api/v1/slm/evidence/label-snapshot/{$label->id}?token={$token}");
        $detectedAt = $label->detected_at ?? $label->first_seen_at ?? $label->created_at;
        $packingCompletedAt = $label->packing_completed_at ? $detectedAt : null;
        if ($label->packing_completed_at || config('cctv.auto_sync_packing')) {
            $packingCompletedAt = $detectedAt;
        }

        $camera = $label->camera;
        $cameraName = $camera?->name ?? 'Meja Packing';
        $cameraLocation = $camera?->location ?? 'Meja Packing';

        $payload = [
            'event_type' => $label->packing_completed_at ? 'packing_completed' : 'invoice_captured',
            'occurred_at' => $detectedAt?->toIso8601String(),
            'camera' => [
                'id' => $camera?->id,
                'name' => $cameraName,
                'location' => $cameraLocation,
            ],
            'data' => [
                'label_id' => $label->id,
                'invoice_number' => $label->field_one,
                'customer_name' => $label->field_two,
                'packing_completed_at' => $packingCompletedAt?->toIso8601String(),
                'detected_at' => $detectedAt?->toIso8601String(),
                'confidence' => (float) $label->confidence,
                'evidence_url' => $photoEvidenceUrl,
                'source_label' => $label->field_three,
                'slm_reference' => $label->slm_reference,
            ],
            // Compatibility fields for legacy flat receivers:
            'cctv_label_id' => $label->id,
            'invoice_number' => $label->field_one,
            'customer_name' => $label->field_two,
            'source_label' => $label->field_three,
            'slm_reference' => $label->slm_reference,
            'first_seen_at' => $label->first_seen_at->toIso8601String(),
            'detected_at' => $detectedAt?->toIso8601String(),
            'occurred_at' => $detectedAt?->toIso8601String(),
            'packing_completed_at' => $packingCompletedAt?->toIso8601String(),
            'confidence' => (float) $label->confidence,
            'evidence_url' => $photoEvidenceUrl,
            'photo_url' => $photoEvidenceUrl,
            'dashboard_url' => $appUrl.'/labels/'.$label->id,
        ];
        $request = Http::withToken($token)->timeout(30)->acceptJson()
            ->withHeaders(['Idempotency-Key' => 'cctv-label-'.$label->id.'-'.$hash]);
        if (config('cctv.slm_sync_upload_photo')) {
            $request = $request->attach('screenshot', $disk->get($label->evidence_path),
                'label-'.$label->id.'.jpg', ['Content-Type' => $disk->mimeType($label->evidence_path)]);
        }
        $response = $request->post(rtrim($base, '/').'/'.ltrim($path, '/'), $payload);
        if (!in_array($response->status(), [200, 201], true) || $response->json('saved') !== true) {
            throw new \RuntimeException('SLM belum mengonfirmasi penyimpanan; HTTP '.$response->status());
        }
        // Perubahan packing saat HTTP berjalan harus tetap menunggu pengiriman versi baru.
        DB::transaction(function () use ($label, $hash) {
            $current=LabelRecord::whereKey($label->id)->lockForUpdate()->firstOrFail();
            if (self::fingerprint($current) !== $hash || !in_array($current->review_status, ['auto_verified', 'auto_read', 'confirmed'], true)) {
                $current->update(['slm_sync_status'=>'not_ready']);
                return;
            }
            $current->update(['slm_sync_status'=>'synced', 'slm_synced_at'=>now(),
                'slm_synced_hash'=>$hash, 'slm_sync_error'=>null]);
        });
    }

    public function failed(?\Throwable $exception): void
    {
        LabelRecord::whereKey($this->labelId)->update(['slm_sync_status' => 'error',
            'slm_sync_error' => $exception ? class_basename($exception) : 'Pengiriman gagal.']);
    }
}

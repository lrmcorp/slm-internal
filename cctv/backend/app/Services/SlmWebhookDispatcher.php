<?php

namespace App\Services;

use App\Jobs\SendSlmWebhookNotification;
use App\Models\Incident;
use App\Models\LabelRecord;

class SlmWebhookDispatcher
{
    public function dispatchIncident(Incident $incident): void
    {
        $camera = $incident->camera;
        $cameraName = $camera?->name ?? 'Kamera Meja Packing';

        $type = $incident->type;
        $severity = match ($type) {
            'anomaly' => 'critical',
            'camera_offline', 'person_absent' => 'warning',
            default => 'info',
        };

        $title = match ($type) {
            'anomaly' => "Dugaan Anomali Meja Packing ({$cameraName})",
            'camera_offline' => "Kamera CCTV Offline ({$cameraName})",
            'person_absent' => "Meja Packing Kosong ({$cameraName})",
            default => "Pemberitahuan CCTV ({$cameraName})",
        };

        $message = match ($type) {
            'anomaly' => "Barang dikeluarkan dari area meja packing tanpa melalui rute packing resmi pada {$cameraName}.",
            'camera_offline' => "Kamera {$cameraName} terputus atau tidak merespons stream video.",
            'person_absent' => "Petugas tidak terdeteksi di {$cameraName} melebihi batas waktu toleransi.",
            default => $incident->reason ?: "Pemberitahuan operasional dari {$cameraName}.",
        };

        $token = (string) config('cctv.slm_token');
        $evidenceUrl = $incident->snapshot_path
            ? url("/api/v1/slm/evidence/incident-snapshot/{$incident->id}?token={$token}")
            : null;
        $clipUrl = $incident->clip_path
            ? url("/api/v1/slm/evidence/incident-clip/{$incident->id}?token={$token}")
            : null;

        $payload = [
            'event_id' => 'cctv_inc_' . $incident->id . '_' . strtotime((string) $incident->occurred_at),
            'event_type' => $type === 'person_absent' ? 'desk_empty' : $type,
            'severity' => $severity,
            'title' => $title,
            'message' => $message,
            'occurred_at' => ($incident->occurred_at ?? now())->toIso8601String(),
            'evidence_url' => $evidenceUrl,
            'clip_url' => $clipUrl,
            'camera' => [
                'id' => $camera?->id,
                'name' => $cameraName,
                'location' => $camera?->location,
            ],
            'data' => [
                'incident_id' => $incident->id,
                'item_count' => $incident->metadata['item_count'] ?? null,
                'duration_seconds' => $incident->metadata['threshold_seconds'] ?? null,
                'reason' => $incident->reason,
                'evidence_url' => $evidenceUrl,
                'clip_url' => $clipUrl,
            ],
        ];

        SendSlmWebhookNotification::dispatch($payload)->onQueue('alerts');
    }

    public function dispatchPackingCompleted(LabelRecord $label): void
    {
        $camera = $label->camera;
        $cameraName = $camera?->name ?? 'Meja Packing';
        $invoice = $label->field_one ?: 'Tanpa Nomor';
        $customer = $label->field_two ?: 'Tanpa Nama';

        $token = (string) config('cctv.slm_token');
        $evidenceUrl = $label->evidence_path
            ? url("/api/v1/slm/evidence/label-snapshot/{$label->id}?token={$token}")
            : null;

        $detectedAt = $label->detected_at ?? $label->first_seen_at ?? $label->created_at;
        $physicalTime = $detectedAt;

        $payload = [
            'event_id' => 'cctv_pack_' . $label->id . '_' . time(),
            'event_type' => 'packing_completed',
            'severity' => 'info',
            'title' => "Packing Selesai: #{$invoice}",
            'message' => "Invoice #{$invoice} ({$customer}) selesai dibungkus di {$cameraName} dan siap dikirim.",
            'occurred_at' => $physicalTime->toIso8601String(),
            'evidence_url' => $evidenceUrl,
            'camera' => [
                'id' => $camera?->id,
                'name' => $cameraName,
                'location' => $camera?->location ?? 'Meja Packing',
            ],
            'data' => [
                'label_id' => $label->id,
                'invoice_number' => $label->field_one,
                'customer_name' => $label->field_two,
                'source_label' => $label->field_three,
                'slm_reference' => $label->slm_reference,
                'first_seen_at' => $label->first_seen_at?->toIso8601String(),
                'detected_at' => $detectedAt?->toIso8601String(),
                'occurred_at' => $physicalTime->toIso8601String(),
                'packing_completed_at' => $physicalTime->toIso8601String(),
                'confidence' => (float) $label->confidence,
                'evidence_url' => $evidenceUrl,
            ],
        ];

        SendSlmWebhookNotification::dispatch($payload)->onQueue('alerts');
    }
}

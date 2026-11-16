<?php

namespace App\Services;

use App\Jobs\SyncMatchedLabelToSlm;
use App\Models\LabelRecord;
use Illuminate\Support\Facades\Http;

class SlmMatcher
{
    public function match(LabelRecord $label, int $dwellSeconds = 0): void
    {
        // Tandai percobaan terakhir; auto-sync mengurutkan dari yang paling lama tidak dicoba.
        $label->touch();
        $base = config('cctv.slm_base_url');
        $token = config('cctv.slm_token');
        $isAllowedUrl = $base && (
            str_starts_with($base, 'https://')
            || app()->environment('local', 'testing')
            || str_starts_with($base, 'http://localhost')
            || str_starts_with($base, 'http://127.0.0.1')
        );
        if (!$base || !$isAllowedUrl || !$token) {
            $label->update(['slm_status' => 'unavailable', 'slm_sync_status' => 'not_ready']);
            return;
        }
        if (!trim($label->field_one ?? '')) {
            $label->update(['slm_status' => 'incomplete', 'slm_sync_status' => 'not_ready']);
            return;
        }

        $minConfidence = (float) config('cctv.min_confidence', 0.90);
        $minDwellSeconds = (int) config('cctv.min_dwell_seconds', 0);
        $recordedDwell = ($label->first_seen_at && $label->last_seen_at)
            ? $label->last_seen_at->diffInSeconds($label->first_seen_at)
            : 0;
        $effectiveDwell = max($dwellSeconds, $recordedDwell);
        $isDwellMet = ($minDwellSeconds <= 0) || ($effectiveDwell >= $minDwellSeconds);
        $isVerified = in_array($label->review_status, ['auto_verified', 'auto_read', 'confirmed'], true);

        try {
            $lookupUrl = rtrim($base, '/').'/'.ltrim(config('cctv.slm_lookup_path'), '/');
            $payload = [
                'invoice_number' => $label->field_one,
                'customer_name' => $label->field_two,
                'source_label' => $label->field_three ?: 'Aneka Jaya',
                'integration_marker' => strtoupper(trim($label->field_three ?? '')) === 'MJ' ? 'MJ INtegration' : null,
            ];
            $response = Http::withToken($token)->timeout(5)->acceptJson()->post($lookupUrl, $payload);
            if (!$response->successful()) {
                $label->update(['slm_status' => 'error', 'slm_sync_status' => 'not_ready']);
                return;
            }
            $data = $response->json();
            if (!is_array($data) || !is_bool($data['matched'] ?? null)) {
                $label->update(['slm_status' => 'error', 'slm_sync_status' => 'not_ready']);
                return;
            }

            // Dual-Strategy Fallback: Jika tidak cocok dan nama customer terisi (misal terdistraksi tulisan sekitar),
            // coba verifikasi nomor invoice saja ke ERP SLM
            if ($data['matched'] === false && !empty($label->field_two)) {
                $fallbackResponse = Http::withToken($token)->timeout(5)->acceptJson()->post($lookupUrl, [
                    'invoice_number' => $label->field_one,
                ]);
                if ($fallbackResponse->successful()) {
                    $fallbackData = $fallbackResponse->json();
                    if (is_array($fallbackData) && ($fallbackData['matched'] ?? false) === true) {
                        $data = $fallbackData;
                        if (!empty($fallbackData['customer_name'])) {
                            $label->update(['field_two' => $fallbackData['customer_name']]);
                        }
                    }
                }
            }

            $matched = $data['matched'] ?? false;
            $slmResponse = [
                'matched' => $matched,
                'reference' => $data['reference'] ?? null,
                'note' => $data['note'] ?? null,
                'customer_name' => $data['customer_name'] ?? null,
                'packing_status' => $data['packing_status'] ?? null,
            ];

            $updateData = [
                'slm_status' => $matched ? 'matched' : 'not_found',
                'slm_reference' => $data['reference'] ?? null,
                'slm_response' => $slmResponse,
            ];
            if ($matched && !empty($data['customer_name'])) {
                $updateData['field_two'] = $data['customer_name'];
            }
            if ($matched && empty($label->field_three)) {
                $updateData['field_three'] = config('cctv.default_store_label', 'Aneka Jaya');
            }
            if ($matched && config('cctv.auto_sync_packing')) {
                if ((float) $label->confidence >= $minConfidence) {
                    $updateData['review_status'] = 'auto_verified';
                }
                $isNowVerified = $isVerified || ((float) $label->confidence >= $minConfidence);
                // Auto-packing hanya aktif jika paket terverifikasi dan memenuhi ambang batas dwell time
                if ($isNowVerified && $isDwellMet) {
                    if (!$label->packing_completed_at) {
                        $updateData['packing_completed_at'] = $label->detected_at ?? $label->first_seen_at ?? $label->created_at;
                    }
                }
            }

            $label->update($updateData);
        } catch (\Throwable $e) {
            report($e);
            $label->update(['slm_status' => 'error', 'slm_sync_status' => 'not_ready']);
            return;
        }

        if (!empty($updateData['packing_completed_at'])) {
            try {
                app(\App\Services\SlmWebhookDispatcher::class)->dispatchPackingCompleted($label);
            } catch (\Throwable $e) {
                report($e);
            }
        }

        if (!$matched) {
            $label->update(['slm_sync_status' => 'not_ready']);
            return;
        }

        $finalStatus = $updateData['review_status'] ?? $label->review_status;
        $isFinallyVerified = in_array($finalStatus, ['auto_verified', 'auto_read', 'confirmed'], true);

        // Verification Gatekeeper: JANGAN masukkan ke antrean sinkronisasi ERP jika belum terverifikasi
        // atau skor confidence di bawah ambang batas (kecuali telah disetujui manual oleh operator).
        if (!$isFinallyVerified || ($finalStatus !== 'confirmed' && (float) $label->confidence < $minConfidence)) {
            $label->update(['slm_sync_status' => 'not_ready']);
            return;
        }

        if ($label->slm_sync_status === 'synced'
            && $label->slm_synced_hash === SyncMatchedLabelToSlm::fingerprint($label)) {
            return;
        }
        if (!config('cctv.slm_sync_path')) {
            $label->update(['slm_sync_status' => 'pending_configuration']);
            return;
        }
        $label->update(['slm_sync_status' => 'queued', 'slm_sync_error' => null]);
        SyncMatchedLabelToSlm::dispatch($label->id);
    }
}

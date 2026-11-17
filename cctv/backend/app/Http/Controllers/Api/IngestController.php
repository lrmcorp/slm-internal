<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\MatchLabelToSlm;
use App\Jobs\VerifyLabelWithAi;
use App\Models\Camera;
use App\Models\Incident;
use App\Models\LabelRecord;
use App\Services\IncidentNotifier;
use App\Services\SlmMatcher;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class IngestController extends Controller
{
    public function config(Camera $camera)
    {
        return response()->json(['stream_env_key' => $camera->stream_env_key,
            'zones' => $camera->zones, 'zones_approved' => $camera->zones_approved_at !== null]);
    }

    public function heartbeat(Request $request, Camera $camera)
    {
        $data = $request->validate(['status' => 'required|in:online,offline,error']);
        $camera->update(['status' => $data['status'], 'last_seen_at' => now()]);
        if ($data['status'] === 'online') {
            Incident::where('camera_id', $camera->id)->whereIn('type', ['camera_offline', 'worker_offline'])
                ->whereNull('resolved_at')->update(['resolved_at' => now()]);
        }
        return response()->json(['ok' => true, 'zones' => $camera->zones,
            'zones_approved' => $camera->zones_approved_at !== null]);
    }

    public function label(Request $request, Camera $camera, SlmMatcher $matcher)
    {
        $data = $request->validate([
            'field_one' => 'required|string|max:100', 'field_two' => 'nullable|string|max:150',
            'field_three' => 'nullable|string|max:100', 'raw_ocr' => 'nullable|string|max:2000',
            'confidence' => 'required|numeric|between:0,1',
            'observed_at' => 'required|date', 'snapshot' => 'required|image|max:4096',
            'dwell_seconds' => 'nullable|integer|min:0',
        ]);
        // Keep the invoice number as text so leading zeroes survive.
        $code = trim($data['field_one']);
        if ($code === '') {
            return response()->json(['message' => 'Kode kosong.'], 422);
        }
        $seen = \Carbon\Carbon::parse($data['observed_at']);
        $query = LabelRecord::where('camera_id', $camera->id)->where('field_one', $code)
            ->where('last_seen_at', '>=', $seen->copy()->subMinutes(5));
        $label = $query->latest('last_seen_at')->first();

        $autoPacking = config('cctv.auto_sync_packing');
        $minConfidence = (float) config('cctv.min_confidence', 0.90);
        $minDwellSeconds = (int) config('cctv.min_dwell_seconds', 0);
        $validStores = ['ANEKA JAYA', 'MJ'];
        $storeCandidate = strtoupper(trim($data['field_three'] ?? ''));
        $isStoreValidOrEmpty = empty($storeCandidate) || in_array($storeCandidate, $validStores, true);
        $isStoreExplicitlyValid = in_array($storeCandidate, $validStores, true);

        // Verification Gatekeeper:
        // 1. Confidence threshold check (confidence >= 0.90)
        $isConfidenceHigh = (float) $data['confidence'] >= $minConfidence;
        // 2. Format check: nomor invoice valid / terbaca utuh
        $isInvoiceFormatValid = (bool) preg_match(\App\Models\LabelRecord::INVOICE_PATTERN, $code);
        // Valid and intact criteria
        $hasCompleteDetails = $isConfidenceHigh && $isInvoiceFormatValid && !empty($data['field_two']) && $isStoreExplicitlyValid;
        $isAutoApproved = $hasCompleteDetails || ($autoPacking && $isConfidenceHigh && $isInvoiceFormatValid && $isStoreValidOrEmpty);

        // Dwell time: waktu keberadaan paket di meja packing
        $requestDwell = (int) ($data['dwell_seconds'] ?? 0);
        $calculatedDwell = $label ? $seen->diffInSeconds($label->first_seen_at) : 0;
        $effectiveDwell = max($requestDwell, $calculatedDwell);

        if ($label) {
            $updates = [
                'last_seen_at' => $seen->greaterThan($label->last_seen_at) ? $seen : $label->last_seen_at,
            ];

            // Smart snapshot upgrade: jika confidence frame baru lebih tinggi atau snapshot lama tidak valid
            $hasNoValidFile = empty($label->evidence_path) || !Storage::disk('local')->exists($label->evidence_path);
            $confidenceImproved = (float) $data['confidence'] > (float) $label->confidence;
            $unverifiedBecameVerified = in_array($label->review_status, ['needs_review', 'pending'], true) && $isAutoApproved;

            if (($confidenceImproved || $hasNoValidFile || $unverifiedBecameVerified) && $request->hasFile('snapshot')) {
                if ($label->evidence_path && Storage::disk('local')->exists($label->evidence_path)) {
                    Storage::disk('local')->delete($label->evidence_path);
                }
                $updates['evidence_path'] = $request->file('snapshot')->store('cctv/labels', 'local');
                $updates['confidence'] = max((float) $label->confidence, (float) $data['confidence']);
            }

            if (empty($label->field_two) && !empty($data['field_two'])) {
                $updates['field_two'] = trim($data['field_two']);
            }
            if (empty($label->field_three) && !empty($data['field_three'])) {
                $updates['field_three'] = trim($data['field_three']);
            } elseif (empty($label->field_three) && $autoPacking && $isStoreValidOrEmpty) {
                $updates['field_three'] = config('cctv.default_store_label', 'Aneka Jaya');
            }

            if ($unverifiedBecameVerified && in_array($label->review_status, ['needs_review', 'pending'], true)) {
                $updates['review_status'] = 'auto_verified';
                Incident::where('type', 'label_needs_review')
                    ->where('metadata->label_id', $label->id)
                    ->whereNull('resolved_at')
                    ->update([
                        'status' => 'confirmed',
                        'resolved_at' => now(),
                        'review_note' => 'Otomatis terverifikasi oleh frame resolusi lebih tinggi (confidence >= 90%).',
                    ]);
            }

            $label->update($updates);

            // Label yang sama terkirim ulang tiap ~10 detik. Setelah cocok, cukup diulang sampai packing otomatis selesai.
            $needsMatch = $label->slm_status !== 'matched'
                || (config('cctv.auto_sync_packing') && !$label->packing_completed_at);
            if ($needsMatch
                && in_array(($updates['review_status'] ?? $label->review_status), ['auto_verified', 'auto_read'], true)) {
                MatchLabelToSlm::dispatch($label->id, $effectiveDwell);
            }
        } else {
            $path = $request->file('snapshot')->store('cctv/labels', 'local');
            $label = LabelRecord::create([
                'camera_id' => $camera->id, 'field_one' => $code,
                'field_two' => trim($data['field_two'] ?? '') ?: null,
                'field_three' => trim($data['field_three'] ?? '') ?: ($autoPacking && $isStoreValidOrEmpty ? config('cctv.default_store_label', 'Aneka Jaya') : null),
                'raw_ocr' => $data['raw_ocr'] ?? null, 'confidence' => $data['confidence'],
                'first_seen_at' => $seen, 'last_seen_at' => $seen, 'evidence_path' => $path,
                'review_status' => $isAutoApproved ? 'auto_verified' : 'needs_review',
            ]);
            if ($label->review_status === 'auto_verified') {
                MatchLabelToSlm::dispatch($label->id, $effectiveDwell);
            } else {
                // Confidence < 0.90 atau belum valid: buat incident di Kejadian / Review untuk verifikasi operator
                $dedupeKey = hash('sha256', 'label_needs_review:' . $camera->id . ':' . $code);
                if (!Incident::where('dedupe_key', $dedupeKey)->whereNull('resolved_at')->exists()) {
                    Incident::create([
                        'camera_id' => $camera->id,
                        'type' => 'label_needs_review',
                        'status' => 'needs_review',
                        'reason' => "Label/Resi #{$code} memiliki skor akurasi " . round($data['confidence'] * 100) . "% (< " . round($minConfidence * 100) . "%) atau belum lengkap. Perlu review operator.",
                        'confidence' => $data['confidence'],
                        'occurred_at' => $seen,
                        'snapshot_path' => $path,
                        'dedupe_key' => $dedupeKey,
                        'metadata' => [
                            'label_id' => $label->id,
                            'field_one' => $code,
                            'field_two' => $label->field_two,
                            'field_three' => $label->field_three,
                        ],
                    ]);
                }
                if (config('cctv.ai_api_key')) {
                    $label->update(['ai_status' => 'queued']);
                    VerifyLabelWithAi::dispatch($label->id);
                }
            }
        }
        return response()->json($label, $label->wasRecentlyCreated ? 201 : 200);
    }

    public function incident(Request $request, Camera $camera, IncidentNotifier $notifier)
    {
        $data = $request->validate([
            'source_event_id' => 'required|string|max:120', 'type' => 'required|in:anomaly',
            'occurred_at' => 'required|date', 'reason' => 'required|string|max:2000',
            'confidence' => 'nullable|numeric|between:0,1', 'item_count' => 'required|integer|between:1,3',
            'exited_boundary' => 'required|boolean', 'passed_packing_route' => 'required|boolean',
            'snapshot' => 'required|image|max:4096', 'clip' => 'nullable|mimes:mp4|max:30720',
        ]);
        if (!$camera->zones_approved_at || !$data['exited_boundary'] || $data['passed_packing_route']) {
            return response()->json(['message' => 'Zona belum disetujui atau aturan anomali tidak terpenuhi.'], 422);
        }
        $key = hash('sha256', $camera->id.':'.$data['source_event_id']);
        if ($existing = Incident::where('dedupe_key', $key)->first()) {
            if (!$existing->clip_path && $request->hasFile('clip')) {
                $existing->update(['clip_path' => $request->file('clip')->store('cctv/incidents', 'local')]);
            }
            return response()->json($existing);
        }
        $snapshot = $request->file('snapshot')->store('cctv/incidents', 'local');
        $clip = $request->hasFile('clip') ? $request->file('clip')->store('cctv/incidents', 'local') : null;
        $incident = Incident::create([
            'camera_id' => $camera->id, 'type' => 'anomaly', 'status' => 'needs_review',
            'reason' => $data['reason'], 'confidence' => $data['confidence'] ?? null,
            'occurred_at' => $data['occurred_at'], 'snapshot_path' => $snapshot,
            'clip_path' => $clip, 'dedupe_key' => $key,
            'metadata' => ['item_count' => $data['item_count'], 'exited_boundary' => true,
                'passed_packing_route' => false],
        ]);
        $notifier->queue($incident);
        return response()->json($incident, 201);
    }

    public function clip(Request $request, Camera $camera, string $sourceEventId)
    {
        $request->validate(['clip' => 'required|mimes:mp4|max:30720']);
        $key = hash('sha256', $camera->id.':'.$sourceEventId);
        $incident = Incident::where('camera_id', $camera->id)->where('dedupe_key', $key)->firstOrFail();
        if (!$incident->clip_path) {
            $incident->update(['clip_path' => $request->file('clip')->store('cctv/incidents', 'local')]);
        }
        return response()->json(['saved' => true]);
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Jobs\SpeakAnnouncement;
use App\Services\CameraSpeaker;
use App\Models\Camera;
use App\Models\Incident;
use App\Models\LabelRecord;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class SlmExternalController extends Controller
{
    public function status(Request $request): JsonResponse
    {
        $fps = (int) env('CCTV_PROCESS_FPS', 3);
        $cameras = Camera::orderBy('name')->get()->map(function ($cam) use ($fps) {
            $isOnline = $cam->status === 'online' && $cam->last_seen_at?->gt(now()->subMinute());
            return [
                'id' => $cam->id,
                'name' => $cam->name,
                'location' => $cam->location,
                'status' => $isOnline ? 'online' : 'offline',
                'fps' => $fps,
                'detector_ready' => (bool) $cam->detector_ready,
                'last_seen_at' => $cam->last_seen_at?->toIso8601String(),
                'fresh' => $cam->frame_at?->gt(now()->subSeconds(20)) ?? false,
            ];
        });

        $offlineCount = $cameras->where('status', 'offline')->count();
        $packedToday = LabelRecord::whereNotNull('packing_completed_at')
            ->whereDate('packing_completed_at', today())
            ->count();
        $activeAnomalies = Incident::where('type', 'anomaly')
            ->where('status', 'needs_review')
            ->whereDate('occurred_at', today())
            ->count();

        return response()->json([
            'status' => 'healthy',
            'cctv_time' => now()->toIso8601String(),
            'fps' => $fps,
            'cameras' => $cameras,
            'totals_today' => [
                'packed_invoices' => $packedToday,
                'active_anomalies' => $activeAnomalies,
                'offline_cameras' => $offlineCount,
            ],
        ]);
    }

    public function invoice(string $invoiceNumber): JsonResponse
    {
        $code = trim($invoiceNumber);
        if ($code === '') {
            return response()->json([
                'found' => false,
                'invoice_number' => '',
                'message' => 'Nomor invoice tidak boleh kosong.',
            ], 422);
        }

        $label = LabelRecord::with('camera')
            ->where('field_one', $code)
            ->latest('first_seen_at')
            ->first();

        if (!$label) {
            return response()->json([
                'found' => false,
                'invoice_number' => $code,
                'message' => 'Invoice belum pernah terpantau kamera CCTV.',
            ], 404);
        }

        $token = (string) config('cctv.slm_token');
        $evidenceUrl = $label->evidence_path
            ? url("/api/v1/slm/evidence/label-snapshot/{$label->id}?token={$token}")
            : null;

        return response()->json([
            'found' => true,
            'invoice_number' => $label->field_one,
            'customer_name' => $label->field_two,
            'store_source' => $label->field_three,
            'packing_status' => $label->packing_completed_at ? 'completed' : 'in_progress',
            'review_status' => $label->review_status,
            'slm_status' => $label->slm_status,
            'slm_sync_status' => $label->slm_sync_status,
            'slm_reference' => $label->slm_reference,
            'first_seen_at' => $label->first_seen_at?->toIso8601String(),
            'packing_completed_at' => $label->packing_completed_at?->toIso8601String(),
            'camera_name' => $label->camera?->name,
            'confidence' => $label->confidence,
            'evidence_url' => $evidenceUrl,
        ]);
    }

    public function events(Request $request): JsonResponse
    {
        $limit = min(100, max(1, (int) $request->query('limit', 20)));
        $type = $request->query('type');
        $since = $request->query('since');
        $sinceDate = null;

        $query = Incident::with('camera')->latest('occurred_at');
        if ($type && $type !== 'packing_completed') {
            $incidentType = $type === 'desk_empty' ? 'person_absent' : $type;
            $query->where('type', $incidentType);
        }
        if ($since) {
            try {
                $sinceDate = \Carbon\Carbon::parse($since);
                $query->where('occurred_at', '>=', $sinceDate);
            } catch (\Throwable) {
                // Parameter tanggal invalid diabaikan secara aman tanpa meledak di database query
            }
        }

        $incidents = $query->take($limit)->get();

        $token = (string) config('cctv.slm_token');
        $events = $incidents->map(function ($incident) use ($token) {
            $cam = $incident->camera;
            $camName = $cam?->name ?? 'Meja Packing';
            $sev = match ($incident->type) {
                'anomaly' => 'critical',
                'camera_offline', 'person_absent' => 'warning',
                default => 'info',
            };
            $evidenceUrl = $incident->snapshot_path
                ? url("/api/v1/slm/evidence/incident-snapshot/{$incident->id}?token={$token}")
                : null;
            $clipUrl = $incident->clip_path
                ? url("/api/v1/slm/evidence/incident-clip/{$incident->id}?token={$token}")
                : null;

            return [
                'event_id' => 'cctv_inc_' . $incident->id,
                'event_type' => $incident->type === 'person_absent' ? 'desk_empty' : $incident->type,
                'severity' => $sev,
                'title' => match ($incident->type) {
                    'anomaly' => "Anomali Meja Packing ({$camName})",
                    'camera_offline' => "Kamera CCTV Offline ({$camName})",
                    'person_absent' => "Meja Packing Kosong ({$camName})",
                    default => "Kejadian CCTV ({$camName})",
                },
                'message' => $incident->reason ?: 'Perlu perhatian operasional.',
                'occurred_at' => $incident->occurred_at?->toIso8601String(),
                'evidence_url' => $evidenceUrl,
                'clip_url' => $clipUrl,
                'camera' => [
                    'id' => $cam?->id,
                    'name' => $cam?->name,
                    'location' => $cam?->location,
                ],
                'data' => [
                    'incident_id' => $incident->id,
                    'item_count' => $incident->metadata['item_count'] ?? null,
                    'reason' => $incident->reason,
                    'evidence_url' => $evidenceUrl,
                    'clip_url' => $clipUrl,
                ],
            ];
        });

        // Jika tidak difilter ke anomali murni, sertakan juga event packing completed
        if (!$type || $type === 'packing_completed') {
            $packingQuery = LabelRecord::with('camera')
                ->whereNotNull('packing_completed_at')
                ->latest('packing_completed_at');
            if ($sinceDate) {
                $packingQuery->where('packing_completed_at', '>=', $sinceDate);
            }
            $labels = $packingQuery->take($limit)->get();

            $packingEvents = $labels->map(function ($label) use ($token) {
                $cam = $label->camera;
                $evidenceUrl = $label->evidence_path
                    ? url("/api/v1/slm/evidence/label-snapshot/{$label->id}?token={$token}")
                    : null;
                $detectedAt = $label->detected_at ?? $label->first_seen_at ?? $label->created_at;
                $packingTime = ($label->packing_completed_by === null && $detectedAt)
                    ? $detectedAt
                    : ($label->packing_completed_at ?? $detectedAt);

                return [
                    'event_id' => 'cctv_pack_' . $label->id,
                    'event_type' => 'packing_completed',
                    'severity' => 'info',
                    'title' => "Packing Selesai: #{$label->field_one}",
                    'message' => "Invoice #{$label->field_one} (" . ($label->field_two ?: 'Tanpa Nama') . ") selesai dipacking.",
                    'occurred_at' => $packingTime?->toIso8601String(),
                    'evidence_url' => $evidenceUrl,
                    'camera' => [
                        'id' => $cam?->id,
                        'name' => $cam?->name,
                        'location' => $cam?->location,
                    ],
                    'data' => [
                        'label_id' => $label->id,
                        'invoice_number' => $label->field_one,
                        'customer_name' => $label->field_two,
                        'source_label' => $label->field_three,
                        'slm_reference' => $label->slm_reference,
                        'first_seen_at' => $label->first_seen_at?->toIso8601String(),
                        'detected_at' => $detectedAt?->toIso8601String(),
                        'occurred_at' => $packingTime?->toIso8601String(),
                        'packing_completed_at' => $packingTime?->toIso8601String(),
                        'evidence_url' => $evidenceUrl,
                    ],
                ];
            });

            $events = $events->concat($packingEvents)
                ->sortByDesc('occurred_at')
                ->values()
                ->take($limit);
        }

        return response()->json([
            'count' => count($events),
            'events' => $events,
        ]);
    }

    /**
     * Pengumuman suara dari SLM, mis. "Ada 3 pesanan yang belum diproses, atas nama ...".
     * Diputar lewat antrean (Google TTS lalu speaker kamera), jadi jawaban langsung 202.
     */
    public function announce(Request $request): JsonResponse
    {
        $data = $request->validate([
            'text' => 'required|string|max:600',
            'channel' => 'nullable|integer|between:1,64',
            'channels' => 'nullable|array|min:1|max:16',
            'channels.*' => 'integer|between:1,64',
            'camera_id' => 'nullable|integer',
            // Bila diisi (mis. "do-backlog"), hasil pemutaran dilaporkan balik ke SLM untuk notifikasi Owner.
            'report' => ['nullable', 'string', 'max:40', 'regex:/^[a-z0-9-]+$/'],
        ]);
        $camera = Camera::find($data['camera_id'] ?? config('cctv.announce_camera_id'));
        if (!$camera) {
            return response()->json(['success' => false, 'message' => 'Kamera untuk pengumuman tidak ditemukan.'], 422);
        }
        if (!CameraSpeaker::endpoint($camera)) {
            return response()->json(['success' => false, 'message' => CameraSpeaker::envKey($camera).' belum diisi.'], 422);
        }
        $channels = array_values(array_unique(array_map('intval', $data['channels'] ?? [$data['channel'] ?? config('cctv.announce_channel')])));
        SpeakAnnouncement::dispatch($camera->id, trim($data['text']), $channels, $data['report'] ?? null)->onQueue('alerts');
        return response()->json(['success' => true, 'data' => ['camera_id' => $camera->id, 'channel' => $channels[0], 'channels' => $channels]], 202);
    }

    public function packingSummary(Request $request): JsonResponse
    {
        $today = today();
        // Rentang waktu (bukan whereDate) agar indeks dipakai; hitung di SQL, bukan memuat semua baris.
        $labelsToday = fn () => LabelRecord::where('first_seen_at', '>=', $today)
            ->where('first_seen_at', '<', $today->copy()->addDay());
        $packed = fn () => $labelsToday()->whereNotNull('packing_completed_at');

        $byStore = $packed()->get(['field_three'])->countBy(fn ($row) => $row->field_three ?: 'Lain-lain');
        $cameraNames = Camera::pluck('name', 'id');
        $byCamera = $packed()->selectRaw('camera_id, count(*) as total')->groupBy('camera_id')->pluck('total', 'camera_id')
            ->mapWithKeys(fn ($total, $id) => [($cameraNames[$id] ?? 'Kamera ' . $id) => $total]);

        return response()->json([
            'date' => $today->toDateString(),
            'total_scanned_today' => $labelsToday()->count(),
            'total_packed_today' => $packed()->count(),
            'by_store' => $byStore,
            'by_camera' => $byCamera,
        ]);
    }

    public function evidence(Request $request, string $kind, int $id)
    {
        return app(CctvController::class)->evidence($request, $kind, $id, [
            'Access-Control-Allow-Origin' => '*',
            'Cache-Control' => 'private, max-age=3600',
        ]);
    }
}

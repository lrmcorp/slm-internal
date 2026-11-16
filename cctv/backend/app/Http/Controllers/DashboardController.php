<?php
namespace App\Http\Controllers;
use App\Models\Camera;
use App\Models\Incident;
use App\Models\LabelRecord;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

class DashboardController extends Controller {
    public static function totals(): array {
        return ['labels'=>LabelRecord::count(), 'pending'=>Incident::where('status','needs_review')->count(),
            'matched'=>LabelRecord::where('slm_status','matched')->count(),
            'packed'=>LabelRecord::whereNotNull('packing_completed_at')->count(),
            'synced'=>LabelRecord::where('slm_sync_status','synced')->count()];
    }

    public static function checkErpHealth(): array {
        $base = config('cctv.slm_base_url');
        $token = config('cctv.slm_token');
        $syncPath = config('cctv.slm_sync_path');
        $isAllowedUrl = $base && (
            str_starts_with($base, 'https://')
            || app()->environment('local', 'testing')
            || str_starts_with($base, 'http://localhost')
            || str_starts_with($base, 'http://127.0.0.1')
        );

        if (!$isAllowedUrl || !filled($token) || !filled($syncPath)) {
            return [
                'status' => 'unconfigured',
                'label' => 'Belum Diatur',
                'latency_ms' => null,
                'message' => 'ERP belum dikonfigurasi (.env)',
                'checked_at' => now()->toIso8601String(),
            ];
        }

        return Cache::remember('cctv_erp_health_check', now()->addSeconds(10), function () use ($base, $token) {
            $path = config('cctv.slm_health_path', '/api/health');
            $url = rtrim($base, '/') . '/' . ltrim($path, '/');
            $start = microtime(true);
            try {
                $response = Http::withToken($token)
                    ->timeout(2)
                    ->acceptJson()
                    ->get($url);
                $latency = (int) round((microtime(true) - $start) * 1000);

                if ($response->successful()) {
                    return [
                        'status' => 'connected',
                        'label' => 'Terhubung (' . $latency . 'ms)',
                        'latency_ms' => $latency,
                        'message' => 'Koneksi ke ERP SLM normal (' . $latency . 'ms)',
                        'checked_at' => now()->toIso8601String(),
                    ];
                }

                return [
                    'status' => 'degraded',
                    'label' => 'HTTP ' . $response->status(),
                    'latency_ms' => $latency,
                    'message' => 'ERP merespons kode HTTP ' . $response->status(),
                    'checked_at' => now()->toIso8601String(),
                ];
            } catch (\Throwable $e) {
                return [
                    'status' => 'disconnected',
                    'label' => 'Terputus',
                    'latency_ms' => null,
                    'message' => 'Gagal menghubungi server SLM (' . class_basename($e) . ')',
                    'checked_at' => now()->toIso8601String(),
                ];
            }
        });
    }

    public function state(Request $request) {
        $labels=LabelRecord::with('camera')->latest('first_seen_at')->paginate(15, ['*'], 'label_page');
        $labels->withPath(url('/'));
        $erpHealth = self::checkErpHealth();
        $storagePath = storage_path('app');
        $freeBytes = @disk_free_space($storagePath);
        $totalBytes = @disk_total_space($storagePath);
        $diskHealth = ($freeBytes !== false && $totalBytes !== false && $totalBytes > 0) ? [
            'free_gb' => round($freeBytes / (1024 * 1024 * 1024), 2),
            'total_gb' => round($totalBytes / (1024 * 1024 * 1024), 2),
            'free_percent' => round(($freeBytes / $totalBytes) * 100, 1),
            'status' => (($freeBytes / $totalBytes) * 100 < (float) config('cctv.min_free_disk_percent', 15.0)) ? 'warning' : 'ok',
        ] : null;

        // Semua tab dashboard berbagi hasil hitung yang sama selama 3 detik (5 COUNT + 1 query per kamera).
        $core = Cache::remember('cctv_dashboard_core', 3, fn () => [
            'totals'=>self::totals(),
            'cameras'=>Camera::orderBy('name')->get()->map(fn($camera)=>[
                'id'=>$camera->id,'online'=>$camera->status==='online' && $camera->last_seen_at?->gt(now()->subMinute()),
                'last_seen_at'=>$camera->last_seen_at?->toIso8601String(),
                'detector_ready'=>$camera->detector_ready,
                'people_count'=>$camera->detector_ready && $camera->frame_at?->gt(now()->subSeconds(20))
                    ? \App\Models\PresenceTrack::where('camera_id',$camera->id)->where('session_id',$camera->tracking_session)->where('last_seen_at','>=',now()->subSeconds(20))->count() : 0,
                'objects_count'=>$camera->detector_ready && $camera->frame_at?->gt(now()->subSeconds(20)) ? count($camera->object_tracks ?? []) : 0,
                'fresh'=>$camera->frame_at?->gt(now()->subSeconds(20)) ?? false])->all(),
        ]);

        return response()->json(['totals'=>$core['totals'], 'cameras'=>$core['cameras'],
            'invoices_html'=>view('partials.invoices',['labels'=>$labels,'current'=>$request->query('section','overview')])->render(),
            'erp_configured'=>$erpHealth['status'] !== 'unconfigured',
            'erp_health'=>$erpHealth,
            'disk_health'=>$diskHealth,
            'updated_at'=>now()->toIso8601String(),
        ])->header('Cache-Control','private, no-store');
    }
}

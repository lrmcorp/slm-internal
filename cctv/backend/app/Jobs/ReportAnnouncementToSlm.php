<?php

namespace App\Jobs;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Hasil pemutaran pengumuman (kanal yang berhasil dan yang gagal) dikirim balik ke SLM, yang lalu memberi
 * push notification ke Owner. Isi pengumuman tidak dikirim balik; SLM sudah memilikinya.
 */
class ReportAnnouncementToSlm implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;
    public array $backoff = [15, 60];

    /** @param list<int> $played @param list<int> $failed */
    public function __construct(public string $report, public array $played, public array $failed, public ?string $error = null)
    {
    }

    public function handle(): void
    {
        $base = (string) config('cctv.slm_base_url');
        $token = (string) config('cctv.slm_token');
        $scheme = strtolower((string) parse_url($base, PHP_URL_SCHEME));
        $allowed = $scheme === 'https' || ($scheme === 'http' && app()->environment('local', 'testing'));
        if (!$allowed || $token === '') {
            Log::debug('Hasil pengumuman tidak dilaporkan: SLM_BASE_URL atau SLM_API_TOKEN belum diisi.');
            return;
        }
        $body = json_encode([
            'report' => $this->report,
            'played_channels' => $this->played,
            'failed_channels' => $this->failed,
            'error' => $this->error,
            'finished_at' => now()->toIso8601String(),
        ], JSON_UNESCAPED_SLASHES);
        $response = Http::timeout(8)
            ->withHeaders([
                'Authorization' => 'Bearer '.$token,
                'X-CCTV-Token' => $token,
                'X-CCTV-Signature' => 'sha256='.hash_hmac('sha256', $body, $token),
                'Accept' => 'application/json',
            ])
            ->withBody($body, 'application/json')
            ->post(rtrim($base, '/').'/'.ltrim((string) config('cctv.slm_announcement_result_path', '/api/cctv/announcements/result'), '/'));
        if ($response->serverError() || $response->status() === 429) {
            throw new RuntimeException('SLM menjawab HTTP '.$response->status());
        }
        Log::info("Hasil pengumuman {$this->report} dilaporkan ke SLM: HTTP {$response->status()}");
    }
}

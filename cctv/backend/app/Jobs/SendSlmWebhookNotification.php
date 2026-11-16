<?php

namespace App\Jobs;

use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class SendSlmWebhookNotification implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;
    public int $timeout = 15;

    public function __construct(public array $eventData) {}

    public function backoff(): array
    {
        return [10, 60, 300];
    }

    public function handle(): void
    {
        if (!config('cctv.slm_webhook_enabled', true)) {
            return;
        }

        $base = config('cctv.slm_base_url');
        $path = config('cctv.slm_events_path', '/api/cctv/events');
        $token = config('cctv.slm_token');

        $scheme = strtolower((string) parse_url((string) $base, PHP_URL_SCHEME));
        $isAllowedBase = !empty($base)
            && in_array($scheme, ['http', 'https'], true)
            && (
                $scheme === 'https'
                || (app()->environment('local', 'testing') && $scheme === 'http')
            );

        if (!$isAllowedBase || empty($token)) {
            Log::debug('SLM Webhook Notification skipped: SLM_BASE_URL or SLM_API_TOKEN is not configured.');
            return;
        }

        $url = rtrim($base, '/') . '/' . ltrim($path, '/');
        $jsonBody = json_encode($this->eventData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $signature = 'sha256=' . hash_hmac('sha256', $jsonBody, $token);

        try {
            $response = Http::timeout(8)
                ->withHeaders([
                    'Authorization' => 'Bearer ' . $token,
                    'X-CCTV-Token' => $token,
                    'X-CCTV-Signature' => $signature,
                    'Accept' => 'application/json',
                    'Content-Type' => 'application/json',
                ])
                ->withBody($jsonBody, 'application/json')
                ->post($url);

            if ($response->successful()) {
                Log::info('SLM Webhook Notification delivered: ' . ($this->eventData['event_type'] ?? 'unknown') . ' (' . ($this->eventData['event_id'] ?? '') . ')');
                return;
            }

            Log::warning('SLM Webhook response failed: HTTP ' . $response->status() . ' from ' . $url . ' - ' . $response->body());
            if ($response->serverError()) {
                throw new \RuntimeException('SLM ERP responded with server error HTTP ' . $response->status());
            }
        } catch (\Throwable $e) {
            Log::error('SLM Webhook Delivery Error: ' . $e->getMessage());
            throw $e;
        }
    }
}

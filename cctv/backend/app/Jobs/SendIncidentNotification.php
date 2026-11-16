<?php

namespace App\Jobs;

use App\Models\Incident;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Mail;
use App\Mail\IncidentAlert;

class SendIncidentNotification implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    public function __construct(public int $deliveryId) {}

    public function backoff(): array
    {
        return [10, 30, 60, 120];
    }

    public function handle(): void
    {
        $delivery = DB::table('notification_deliveries')->find($this->deliveryId);
        if (!$delivery || $delivery->status === 'sent') {
            return;
        }
        $incident = Incident::with('camera')->findOrFail($delivery->incident_id);
        DB::table('notification_deliveries')->where('id', $this->deliveryId)
            ->update(['status' => 'sending', 'attempts' => DB::raw('attempts + 1'), 'updated_at' => now()]);
        try {
            if ($delivery->channel === 'push') {
                $this->sendPush($delivery->user_id, $incident);
            } elseif ($delivery->channel === 'email') {
                $this->sendEmail($delivery->user_id, $incident);
            } elseif ($delivery->channel === 'whatsapp') {
                $this->sendWhatsApp($delivery->user_id, $incident);
            } else {
                throw new \RuntimeException('Unsupported channel');
            }
            DB::table('notification_deliveries')->where('id', $this->deliveryId)
                ->update(['status' => 'sent', 'sent_at' => now(), 'last_error' => null, 'updated_at' => now()]);
        } catch (\Throwable $e) {
            DB::table('notification_deliveries')->where('id', $this->deliveryId)->update([
                'status' => 'retrying', 'next_attempt_at' => now()->addSeconds($this->backoff()[min($delivery->attempts, 3)]),
                'last_error' => $e instanceof \Illuminate\Http\Client\RequestException
                    ? 'HTTP '.$e->response->status() : get_class($e), 'updated_at' => now(),
            ]);
            throw $e;
        }
    }

    public function failed(?\Throwable $exception): void
    {
        DB::table('notification_deliveries')->where('id', $this->deliveryId)
            ->update(['status' => 'failed', 'updated_at' => now()]);
    }

    private function summary(Incident $incident): array
    {
        $title = match ($incident->type) {
            'anomaly' => 'Dugaan anomali yang perlu diperiksa',
            'person_absent' => 'Track tidak terlihat; perlu diperiksa',
            default => 'Pemantauan CCTV terhenti',
        };
        return [$title,
            $incident->occurred_at->timezone('Asia/Jakarta')->format('d M Y H:i').' WIB · '.
            $incident->camera->name.' · '.$incident->reason,
            route('dashboard.incident', $incident->id)];
    }

    private function sendEmail(int $userId, Incident $incident): void
    {
        // Logging mailers must never be reported as a successful delivery.
        if (!in_array(config('mail.default'), ['smtp', 'sendmail', 'ses', 'postmark', 'resend'], true)) {
            throw new \RuntimeException('Email transport is not configured');
        }
        $email = DB::table('users')->where('id', $userId)->value('email');
        if (!$email || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new \RuntimeException('Recipient email is missing');
        }
        [$title, $body, $url] = $this->summary($incident);
        Mail::to($email)->send(new IncidentAlert($title, $body, $url, $incident->snapshot_path));
    }

    private function sendPush(int $userId, Incident $incident): void
    {
        $project = config('cctv.fcm_project_id');
        $file = config('cctv.fcm_service_account_file');
        if (!$project || !$file || !is_readable($file)) {
            throw new \RuntimeException('FCM is not configured');
        }
        $credentials = json_decode(file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);
        if (($credentials['project_id'] ?? null) !== $project || empty($credentials['client_email']) || empty($credentials['private_key'])) {
            throw new \RuntimeException('Invalid FCM service account');
        }
        $tokens = DB::table('device_tokens')->where('user_id', $userId)->get();
        if ($tokens->isEmpty()) {
            throw new \RuntimeException('No registered device token');
        }
        $now = time();
        $encode = fn ($data) => rtrim(strtr(base64_encode(json_encode($data, JSON_UNESCAPED_SLASHES)), '+/', '-_'), '=');
        $unsigned = $encode(['alg' => 'RS256', 'typ' => 'JWT']).'.'.$encode([
            'iss' => $credentials['client_email'], 'scope' => 'https://www.googleapis.com/auth/firebase.messaging',
            'aud' => 'https://oauth2.googleapis.com/token', 'iat' => $now, 'exp' => $now + 3600,
        ]);
        if (!openssl_sign($unsigned, $signature, $credentials['private_key'], OPENSSL_ALGO_SHA256)) {
            throw new \RuntimeException('FCM signing failed');
        }
        $jwt = $unsigned.'.'.rtrim(strtr(base64_encode($signature), '+/', '-_'), '=');
        $oauth = Http::asForm()->timeout(10)->post('https://oauth2.googleapis.com/token', [
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion' => $jwt,
        ])->throw()->json('access_token');
        [$title, $body, $url] = $this->summary($incident);
        foreach ($tokens as $token) {
            Http::withToken($oauth)->timeout(10)->post(
                "https://fcm.googleapis.com/v1/projects/{$project}/messages:send",
                ['message' => [
                    'token' => decrypt($token->token_encrypted),
                    'notification' => ['title' => $title, 'body' => $body],
                    'data' => ['incident_id' => (string) $incident->id, 'url' => $url],
                    'android' => ['priority' => 'high'],
                    'apns' => ['payload' => ['aps' => ['sound' => 'default']]],
                ]]
            )->throw();
        }
    }

    private function sendWhatsApp(int $userId, Incident $incident): void
    {
        $phoneId = config('cctv.wa_phone_number_id');
        $token = config('cctv.wa_access_token');
        $template = config('cctv.wa_template_name');
        $rule = DB::table('notification_rules')->where('user_id', $userId)
            ->where('incident_type', $incident->type)->where('channel', 'whatsapp')->first();
        if (!$phoneId || !$token || !$template || !$rule?->whatsapp_number) {
            throw new \RuntimeException('WhatsApp Cloud API is not configured');
        }
        [$title, $body, $url] = $this->summary($incident);
        $components = [['type' => 'body', 'parameters' => [
            ['type' => 'text', 'text' => $title], ['type' => 'text', 'text' => $body],
            ['type' => 'text', 'text' => $url],
        ]]];
        $imageTemplate = config('cctv.wa_image_template_name');
        $disk = Storage::disk('local');
        if ($imageTemplate && $incident->snapshot_path && $disk->exists($incident->snapshot_path)) {
            // Upload privately to Meta; never publish an unauthenticated evidence URL.
            $mime = $disk->mimeType($incident->snapshot_path);
            $mediaId = Http::withToken($token)->timeout(15)
                ->attach('file', $disk->get($incident->snapshot_path), basename($incident->snapshot_path),
                    ['Content-Type' => $mime])
                ->post("https://graph.facebook.com/v23.0/{$phoneId}/media", [
                    'messaging_product' => 'whatsapp', 'type' => $mime,
                ])->throw()->json('id');
            if (!$mediaId) throw new \RuntimeException('WhatsApp media upload has no ID');
            $template = $imageTemplate;
            array_unshift($components, ['type' => 'header', 'parameters' => [
                ['type' => 'image', 'image' => ['id' => $mediaId]],
            ]]);
        }
        Http::withToken($token)->timeout(10)->post("https://graph.facebook.com/v23.0/{$phoneId}/messages", [
            'messaging_product' => 'whatsapp', 'to' => ltrim($rule->whatsapp_number, '+'),
            'type' => 'template', 'template' => ['name' => $template, 'language' => ['code' => 'id'],
                'components' => $components],
        ])->throw();
    }
}

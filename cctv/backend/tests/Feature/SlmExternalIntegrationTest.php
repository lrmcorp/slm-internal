<?php

namespace Tests\Feature;

use App\Jobs\SendSlmWebhookNotification;
use App\Models\Camera;
use App\Models\Incident;
use App\Models\LabelRecord;
use App\Models\User;
use App\Services\IncidentNotifier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class SlmExternalIntegrationTest extends TestCase
{
    use RefreshDatabase;

    private string $token = 'secret-slm-integration-token-12345';

    protected function setUp(): void
    {
        parent::setUp();
        Config::set('cctv.slm_token', $this->token);
        Config::set('cctv.slm_base_url', 'https://slm.playgo.id');
        Config::set('cctv.slm_events_path', '/api/cctv/events');
        Config::set('cctv.slm_webhook_enabled', true);
    }

    private function camera(): Camera
    {
        return Camera::create([
            'name' => 'Meja Packing 1',
            'location' => 'Gudang AJ',
            'stream_env_key' => 'CCTV_CAMERA_1_URL',
            'status' => 'online',
            'detector_ready' => true,
            'last_seen_at' => now(),
            'frame_at' => now(),
        ]);
    }

    public function test_slm_api_requires_valid_token(): void
    {
        // Tanpa token
        $this->getJson('/api/v1/slm/status')->assertStatus(401);

        // Token salah
        $this->withToken('wrong-token')
            ->getJson('/api/v1/slm/status')
            ->assertStatus(401);

        // Token benar via Bearer
        $this->withToken($this->token)
            ->getJson('/api/v1/slm/status')
            ->assertOk();

        // Token benar via Header X-SLM-Token
        $this->withHeaders(['X-SLM-Token' => $this->token])
            ->getJson('/api/v1/slm/status')
            ->assertOk();
    }

    public function test_slm_api_status_returns_camera_health_and_totals(): void
    {
        $cam = $this->camera();
        LabelRecord::create([
            'camera_id' => $cam->id,
            'field_one' => '101026-01',
            'confidence' => 0.95,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
            'packing_completed_at' => now(),
        ]);

        $res = $this->withToken($this->token)->getJson('/api/v1/slm/status');
        $res->assertOk()
            ->assertJsonPath('status', 'healthy')
            ->assertJsonPath('totals_today.packed_invoices', 1)
            ->assertJsonPath('cameras.0.id', $cam->id)
            ->assertJsonPath('cameras.0.status', 'online');
    }

    public function test_slm_api_can_stream_camera_with_token(): void
    {
        \Illuminate\Support\Facades\Storage::fake('local');
        $cam = $this->camera();
        $fakePath = 'cctv/live/test.jpg';
        \Illuminate\Support\Facades\Storage::disk('local')->put($fakePath, 'fake-jpeg-content');
        $cam->update(['live_path' => $fakePath, 'frame_at' => now()]);

        // 1. Direct web stream route with SLM Bearer Token
        $this->withToken($this->token)
            ->get('/cameras/' . $cam->id . '/stream')
            ->assertOk()
            ->assertHeader('Access-Control-Allow-Origin', '*');

        // 2. Direct web stream route with ?token= query parameter
        $this->get('/cameras/' . $cam->id . '/stream?token=' . $this->token)
            ->assertOk()
            ->assertHeader('Access-Control-Allow-Origin', '*');

        // 3. API prefix route with SLM Token
        $this->withToken($this->token)
            ->get('/api/v1/slm/cameras/' . $cam->id . '/stream')
            ->assertOk()
            ->assertHeader('Access-Control-Allow-Origin', '*');

        // 4. Unauthorized without token
        $this->flushHeaders();
        $this->get('/cameras/' . $cam->id . '/stream')
            ->assertRedirect(route('login'));
    }

    public function test_slm_api_invoice_lookup_returns_packing_status(): void
    {
        $cam = $this->camera();
        LabelRecord::create([
            'camera_id' => $cam->id,
            'field_one' => '101026-31',
            'field_two' => 'ARI BOGOR',
            'field_three' => 'Aneka Jaya',
            'confidence' => 0.98,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
            'packing_completed_at' => now(),
            'slm_status' => 'matched',
            'slm_reference' => 'SO-101026-31',
        ]);

        // Invoice ditemukan
        $res = $this->withToken($this->token)->getJson('/api/v1/slm/invoices/101026-31');
        $res->assertOk()
            ->assertJsonPath('found', true)
            ->assertJsonPath('invoice_number', '101026-31')
            ->assertJsonPath('customer_name', 'ARI BOGOR')
            ->assertJsonPath('packing_status', 'completed')
            ->assertJsonPath('camera_name', 'Meja Packing 1');

        // Invoice tidak ditemukan
        $this->withToken($this->token)->getJson('/api/v1/slm/invoices/NON-EXISTENT')
            ->assertStatus(404)
            ->assertJsonPath('found', false);
    }

    public function test_slm_api_events_returns_filtered_recent_events(): void
    {
        $cam = $this->camera();
        Incident::create([
            'camera_id' => $cam->id,
            'type' => 'anomaly',
            'status' => 'needs_review',
            'reason' => 'Barang keluar meja tanpa packing',
            'occurred_at' => now(),
            'dedupe_key' => 'dedupe-1',
            'metadata' => ['item_count' => 1],
        ]);
        Incident::create([
            'camera_id' => $cam->id,
            'type' => 'person_absent',
            'status' => 'needs_review',
            'reason' => 'Meja kosong 15 menit',
            'occurred_at' => now(),
            'dedupe_key' => 'dedupe-2',
            'metadata' => ['threshold_seconds' => 900],
        ]);

        // Filter anomaly
        $res = $this->withToken($this->token)->getJson('/api/v1/slm/events?type=anomaly');
        $res->assertOk()
            ->assertJsonPath('count', 1)
            ->assertJsonPath('events.0.event_type', 'anomaly')
            ->assertJsonPath('events.0.severity', 'critical');

        // Filter desk_empty
        $resEmpty = $this->withToken($this->token)->getJson('/api/v1/slm/events?type=desk_empty');
        $resEmpty->assertOk()
            ->assertJsonPath('count', 1)
            ->assertJsonPath('events.0.event_type', 'desk_empty')
            ->assertJsonPath('events.0.severity', 'warning');
    }

    public function test_slm_api_packing_summary_returns_aggregated_metrics(): void
    {
        $cam = $this->camera();
        LabelRecord::create([
            'camera_id' => $cam->id,
            'field_one' => '101026-10',
            'field_three' => 'Aneka Jaya',
            'confidence' => 0.9,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
            'packing_completed_at' => now(),
        ]);

        $res = $this->withToken($this->token)->getJson('/api/v1/slm/packing/summary');
        $res->assertOk()
            ->assertJsonPath('total_scanned_today', 1)
            ->assertJsonPath('total_packed_today', 1)
            ->assertJsonPath('by_store.Aneka Jaya', 1);
    }

    public function test_incident_triggers_webhook_push_to_erp_slm(): void
    {
        Queue::fake();
        $cam = $this->camera();
        $incident = Incident::create([
            'camera_id' => $cam->id,
            'type' => 'anomaly',
            'status' => 'needs_review',
            'reason' => 'Barang keluar meja tanpa rute packing',
            'occurred_at' => now(),
            'dedupe_key' => 'dedupe-anomaly-webhook',
            'metadata' => ['item_count' => 1],
        ]);

        app(IncidentNotifier::class)->queue($incident);

        Queue::assertPushed(SendSlmWebhookNotification::class, function ($job) {
            return $job->eventData['event_type'] === 'anomaly'
                && $job->eventData['severity'] === 'critical'
                && str_contains($job->eventData['title'], 'Anomali Meja Packing');
        });
    }

    public function test_packing_completed_triggers_webhook_push_to_erp_slm(): void
    {
        Queue::fake();
        $cam = $this->camera();
        $user = User::factory()->create();

        $label = LabelRecord::create([
            'camera_id' => $cam->id,
            'field_one' => '101026-88',
            'field_two' => 'BUDI STORE',
            'field_three' => 'Aneka Jaya',
            'confidence' => 0.99,
            'review_status' => 'confirmed',
            'first_seen_at' => now(),
            'last_seen_at' => now(),
        ]);

        $this->actingAs($user)->postJson("/labels/{$label->id}/packing-complete")->assertOk();

        Queue::assertPushed(SendSlmWebhookNotification::class, function ($job) {
            return $job->eventData['event_type'] === 'packing_completed'
                && $job->eventData['severity'] === 'info'
                && $job->eventData['data']['invoice_number'] === '101026-88';
        });
    }

    public function test_webhook_job_sends_http_post_with_hmac_signature(): void
    {
        Http::fake(['slm.playgo.id/*' => Http::response(['success' => true], 200)]);

        $eventData = [
            'event_id' => 'evt-test-123',
            'event_type' => 'anomaly',
            'severity' => 'critical',
            'title' => 'Anomali Meja Packing',
            'message' => 'Barang dipindahkan tanpa scan',
            'occurred_at' => now()->toIso8601String(),
        ];

        (new SendSlmWebhookNotification($eventData))->handle();

        Http::assertSent(function ($request) use ($eventData) {
            $hasToken = $request->header('X-CCTV-Token')[0] === $this->token;
            $sigHeader = $request->header('X-CCTV-Signature')[0] ?? '';
            $hasSig = str_starts_with($sigHeader, 'sha256=');
            $expectedSig = 'sha256=' . hash_hmac('sha256', json_encode($eventData, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $this->token);
            return $request->url() === 'https://slm.playgo.id/api/cctv/events'
                && $hasToken
                && $hasSig
                && $sigHeader === $expectedSig
                && $request['event_type'] === 'anomaly';
        });
    }
}

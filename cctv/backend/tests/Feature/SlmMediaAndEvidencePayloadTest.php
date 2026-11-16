<?php

namespace Tests\Feature;

use App\Jobs\SendSlmWebhookNotification;
use App\Models\Camera;
use App\Models\Incident;
use App\Models\LabelRecord;
use App\Services\SlmWebhookDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class SlmMediaAndEvidencePayloadTest extends TestCase
{
    use RefreshDatabase;

    private string $token = 'cctv_slm_test_token_0123456789abcdef';

    protected function setUp(): void
    {
        parent::setUp();
        Config::set('cctv.slm_token', $this->token);
        Config::set('cctv.slm_base_url', 'https://slm.playgo.id');
        Config::set('cctv.slm_events_path', '/api/cctv/events');
        Config::set('cctv.slm_webhook_enabled', true);
        Storage::fake('local');
    }

    private function createCamera(): Camera
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

    public function test_evidence_endpoint_serves_image_with_token_query_and_cors_headers(): void
    {
        $cam = $this->createCamera();
        $fakePath = 'cctv/labels/evidence-test.jpg';
        Storage::disk('local')->put($fakePath, 'fake-jpeg-binary-data');

        $label = LabelRecord::create([
            'camera_id' => $cam->id,
            'field_one' => '101026-99',
            'evidence_path' => $fakePath,
            'confidence' => 0.99,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
        ]);

        // 1. Akses via query param ?token= (untuk <img> tag di web ERP)
        $resQuery = $this->get("/api/v1/slm/evidence/label-snapshot/{$label->id}?token={$this->token}");
        $resQuery->assertOk();
        $resQuery->assertHeader('Access-Control-Allow-Origin', '*');
        $this->assertEquals('fake-jpeg-binary-data', $resQuery->streamedContent());

        // 2. Akses via Bearer header
        $resBearer = $this->withToken($this->token)->get("/api/v1/slm/evidence/label-snapshot/{$label->id}");
        $resBearer->assertOk();
        $resBearer->assertHeader('Access-Control-Allow-Origin', '*');

        // 3. Preflight OPTIONS request
        $resOptions = $this->call('OPTIONS', "/api/v1/slm/evidence/label-snapshot/{$label->id}");
        $resOptions->assertStatus(204);
        $resOptions->assertHeader('Access-Control-Allow-Origin', '*');
        $resOptions->assertHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

        // 4. Token salah ditolak 401
        $this->flushHeaders();
        $this->get("/api/v1/slm/evidence/label-snapshot/{$label->id}?token=invalid-token")
            ->assertStatus(401);

        // 5. File tidak ada menghasilkan 404
        $labelWithoutFile = LabelRecord::create([
            'camera_id' => $cam->id,
            'field_one' => '101026-missing',
            'evidence_path' => 'cctv/labels/non-existent.jpg',
            'confidence' => 0.99,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
        ]);
        $this->get("/api/v1/slm/evidence/label-snapshot/{$labelWithoutFile->id}?token={$this->token}")
            ->assertStatus(404);
    }

    public function test_status_endpoint_returns_fps_in_server_and_camera_items(): void
    {
        $cam = $this->createCamera();

        $res = $this->withToken($this->token)->getJson('/api/v1/slm/status');
        $res->assertOk()
            ->assertJsonPath('status', 'healthy')
            ->assertJsonPath('fps', 3)
            ->assertJsonPath('cameras.0.id', $cam->id)
            ->assertJsonPath('cameras.0.fps', 3);
    }

    public function test_invoice_endpoint_returns_evidence_url(): void
    {
        $cam = $this->createCamera();
        $fakePath = 'cctv/labels/invoice-99.jpg';
        Storage::disk('local')->put($fakePath, 'sample-data');

        $label = LabelRecord::create([
            'camera_id' => $cam->id,
            'field_one' => '101026-99',
            'field_two' => 'Budi Jakarta',
            'evidence_path' => $fakePath,
            'confidence' => 0.95,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
        ]);

        $res = $this->withToken($this->token)->getJson('/api/v1/slm/invoices/101026-99');
        $res->assertOk()
            ->assertJsonPath('found', true)
            ->assertJsonPath('invoice_number', '101026-99');

        $evidenceUrl = $res->json('evidence_url');
        $this->assertNotNull($evidenceUrl);
        $this->assertStringContainsString("/api/v1/slm/evidence/label-snapshot/{$label->id}", $evidenceUrl);
        $this->assertStringContainsString("token={$this->token}", $evidenceUrl);
    }

    public function test_events_endpoint_returns_evidence_url_and_clip_url(): void
    {
        $cam = $this->createCamera();
        $fakeSnap = 'cctv/incidents/snap-1.jpg';
        $fakeClip = 'cctv/incidents/clip-1.mp4';
        Storage::disk('local')->put($fakeSnap, 'fake-snap');
        Storage::disk('local')->put($fakeClip, 'fake-clip');

        $incident = Incident::create([
            'camera_id' => $cam->id,
            'type' => 'anomaly',
            'status' => 'needs_review',
            'reason' => 'Barang terlempar',
            'occurred_at' => now(),
            'dedupe_key' => 'dedupe-evidence-test',
            'snapshot_path' => $fakeSnap,
            'clip_path' => $fakeClip,
            'metadata' => ['item_count' => 1],
        ]);

        $fakePackSnap = 'cctv/labels/pack-1.jpg';
        Storage::disk('local')->put($fakePackSnap, 'fake-pack-snap');

        $label = LabelRecord::create([
            'camera_id' => $cam->id,
            'field_one' => '101026-PACKED',
            'evidence_path' => $fakePackSnap,
            'confidence' => 0.99,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
            'packing_completed_at' => now(),
        ]);

        $res = $this->withToken($this->token)->getJson('/api/v1/slm/events');
        $res->assertOk();

        $events = collect($res->json('events'));

        $incEvent = $events->firstWhere('event_id', 'cctv_inc_' . $incident->id);
        $this->assertNotNull($incEvent);
        $this->assertStringContainsString("/api/v1/slm/evidence/incident-snapshot/{$incident->id}", $incEvent['evidence_url']);
        $this->assertStringContainsString("/api/v1/slm/evidence/incident-clip/{$incident->id}", $incEvent['clip_url']);
        $this->assertEquals($incEvent['evidence_url'], $incEvent['data']['evidence_url']);

        $packEvent = $events->firstWhere('event_id', 'cctv_pack_' . $label->id);
        $this->assertNotNull($packEvent);
        $this->assertStringContainsString("/api/v1/slm/evidence/label-snapshot/{$label->id}", $packEvent['evidence_url']);
        $this->assertEquals($packEvent['evidence_url'], $packEvent['data']['evidence_url']);
    }

    public function test_dispatcher_includes_evidence_urls_in_pushed_webhook(): void
    {
        Queue::fake();
        $cam = $this->createCamera();

        $label = LabelRecord::create([
            'camera_id' => $cam->id,
            'field_one' => '101026-WEBHOOK',
            'field_two' => 'Andi Bandung',
            'evidence_path' => 'cctv/labels/snap-label.jpg',
            'confidence' => 0.95,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
            'packing_completed_at' => now(),
            'slm_reference' => 'SO-101026-WEBHOOK',
        ]);

        app(SlmWebhookDispatcher::class)->dispatchPackingCompleted($label);

        Queue::assertPushed(SendSlmWebhookNotification::class, function ($job) use ($label) {
            $data = $job->eventData;
            return $data['event_type'] === 'packing_completed'
                && isset($data['evidence_url'])
                && str_contains($data['evidence_url'], "/api/v1/slm/evidence/label-snapshot/{$label->id}")
                && isset($data['data']['evidence_url'])
                && str_contains($data['data']['evidence_url'], "/api/v1/slm/evidence/label-snapshot/{$label->id}");
        });
    }

    public function test_webhook_job_sends_dual_auth_headers(): void
    {
        Http::fake([
            'https://slm.playgo.id/api/cctv/events' => Http::response(['status' => 'received'], 200),
        ]);

        $job = new SendSlmWebhookNotification([
            'event_id' => 'cctv_test_dual_headers',
            'event_type' => 'packing_completed',
            'title' => 'Test Dual Header Auth',
            'message' => 'Testing X-CCTV-Token and Authorization Bearer',
        ]);

        $job->handle();

        Http::assertSent(function ($request) {
            return $request->hasHeader('Authorization', 'Bearer ' . $this->token)
                && $request->hasHeader('X-CCTV-Token', $this->token)
                && $request->hasHeader('X-CCTV-Signature');
        });
    }

    public function test_sync_job_payload_includes_image_evidence_url_and_dashboard_url(): void
    {
        $cam = $this->createCamera();
        $fakePath = 'cctv/labels/invoice-sync.jpg';
        Storage::disk('local')->put($fakePath, 'sample-binary-photo');

        $label = LabelRecord::create([
            'camera_id' => $cam->id,
            'field_one' => '101026-88',
            'field_two' => 'Budi Jakarta',
            'field_three' => 'Aneka Jaya',
            'evidence_path' => $fakePath,
            'confidence' => 0.99,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
            'review_status' => 'confirmed',
            'slm_status' => 'matched',
            'slm_reference' => 'REF-SYNC-88',
            'packing_completed_at' => now(),
        ]);

        Config::set('cctv.slm_sync_path', '/api/cctv/labels/sync');
        Config::set('app.url', 'https://cctvslm.playgo.id');
        Config::set('cctv.slm_sync_upload_photo', false);

        Http::fake([
            'https://slm.playgo.id/api/cctv/labels/sync' => Http::response(['saved' => true], 200),
        ]);

        (new \App\Jobs\SyncMatchedLabelToSlm($label->id))->handle();

        Http::assertSent(function ($request) use ($label) {
            return $request->url() === 'https://slm.playgo.id/api/cctv/labels/sync'
                && str_contains($request['evidence_url'], "/api/v1/slm/evidence/label-snapshot/{$label->id}")
                && str_contains($request['evidence_url'], "token={$this->token}")
                && $request['dashboard_url'] === "https://cctvslm.playgo.id/labels/{$label->id}"
                && $request['photo_url'] === $request['evidence_url'];
        });
    }

    public function test_smart_rescan_upgrades_pending_low_confidence_label_with_sharp_snapshot(): void
    {
        $ingestToken = str_repeat('a', 64);
        Config::set('cctv.ingest_token', $ingestToken);
        Config::set('cctv.auto_sync_packing', true);
        Config::set('cctv.slm_lookup_path', '/api/cctv/labels/lookup');

        Http::fake([
            'https://slm.playgo.id/api/cctv/labels/lookup' => Http::response([
                'matched' => true,
                'reference' => 'SO-UPGRADE-1',
                'customer_name' => 'Toko Hansel Jaya',
            ], 200),
        ]);

        $cam = $this->createCamera();

        // 1. Scan pertama: low confidence (0.50), status pending
        $file1 = \Illuminate\Http\UploadedFile::fake()->create('frame1.jpg', 100, 'image/jpeg');
        $res1 = $this->withHeaders(['X-CCTV-Ingest-Token' => $ingestToken])
            ->post("/api/ingest/cameras/{$cam->id}/labels", [
                'field_one' => '201026-11',
                'confidence' => 0.50,
                'observed_at' => now()->toIso8601String(),
                'snapshot' => $file1,
            ]);
        $res1->assertCreated();

        $label = LabelRecord::where('field_one', '201026-11')->first();
        $this->assertNotNull($label);
        $this->assertEquals(0.50, (float) $label->confidence);
        $this->assertEquals('needs_review', $label->review_status);
        $firstPath = $label->evidence_path;
        $this->assertTrue(Storage::disk('local')->exists($firstPath));

        // 2. Scan kedua (1 menit kemudian): high confidence (0.95), customer terbaca jelas
        $file2 = \Illuminate\Http\UploadedFile::fake()->create('frame2.jpg', 120, 'image/jpeg');
        $res2 = $this->withHeaders(['X-CCTV-Ingest-Token' => $ingestToken])
            ->post("/api/ingest/cameras/{$cam->id}/labels", [
                'field_one' => '201026-11',
                'field_two' => 'Toko Hansel Jaya',
                'field_three' => 'Aneka Jaya',
                'confidence' => 0.95,
                'observed_at' => now()->addMinute()->toIso8601String(),
                'snapshot' => $file2,
            ]);
        $res2->assertOk();

        // Hanya ada 1 record di database (tidak duplikat)
        $this->assertEquals(1, LabelRecord::where('field_one', '201026-11')->count());

        $fresh = $label->fresh();
        $this->assertEquals(0.95, (float) $fresh->confidence);
        $this->assertEquals('auto_verified', $fresh->review_status);
        $this->assertEquals('matched', $fresh->slm_status);
        $this->assertNotEquals($firstPath, $fresh->evidence_path);
        $this->assertTrue(Storage::disk('local')->exists($fresh->evidence_path));
        // File lama dibersihkan
        $this->assertFalse(Storage::disk('local')->exists($firstPath));
    }

    public function test_sync_job_payload_uses_physical_detection_timestamp_for_occurred_at_and_packing_completed_at(): void
    {
        $camera = Camera::create(['name' => 'Meja Packing 1', 'stream_env_key' => 'CCTV_URL']);
        $fakePath = 'cctv/test-label-14oct.jpg';
        Storage::disk('local')->put($fakePath, 'dummy-image-bytes');

        $detectedPhysicalTime = \Carbon\Carbon::parse('2026-10-14 09:45:30');

        $label = LabelRecord::create([
            'camera_id' => $camera->id,
            'field_one' => '141026-01',
            'field_two' => 'Toko Sinar 14 Oktober',
            'field_three' => 'Aneka Jaya',
            'evidence_path' => $fakePath,
            'confidence' => 0.99,
            'first_seen_at' => $detectedPhysicalTime,
            'last_seen_at' => $detectedPhysicalTime,
            'created_at' => $detectedPhysicalTime,
            'review_status' => 'confirmed',
            'slm_status' => 'matched',
            'slm_reference' => 'REF-14OCT-99',
            'packing_completed_at' => $detectedPhysicalTime,
        ]);

        Config::set('cctv.slm_sync_path', '/api/cctv/labels/sync');
        Config::set('app.url', 'https://cctvslm.playgo.id');
        Config::set('cctv.slm_sync_upload_photo', false);

        Http::fake([
            'https://slm.playgo.id/api/cctv/labels/sync' => Http::response(['saved' => true], 200),
        ]);

        (new \App\Jobs\SyncMatchedLabelToSlm($label->id))->handle();

        Http::assertSent(function ($request) use ($label, $detectedPhysicalTime) {
            $expectedIso = $detectedPhysicalTime->toIso8601String();
            return $request->url() === 'https://slm.playgo.id/api/cctv/labels/sync'
                && $request['cctv_label_id'] === $label->id
                && $request['invoice_number'] === '141026-01'
                && $request['occurred_at'] === $expectedIso
                && $request['packing_completed_at'] === $expectedIso
                && $request['detected_at'] === $expectedIso
                && $request['first_seen_at'] === $expectedIso
                && !str_contains($request['occurred_at'], now()->format('Y-m-d'));
        });
    }

    public function test_auto_sync_and_slm_matcher_assign_physical_first_seen_at_instead_of_now(): void
    {
        $camera = Camera::create(['name' => 'Meja Packing 2', 'stream_env_key' => 'CCTV_URL']);
        $detectedPhysicalTime = \Carbon\Carbon::parse('2026-10-14 10:15:00');

        $label = LabelRecord::create([
            'camera_id' => $camera->id,
            'field_one' => '141026-02',
            'field_two' => 'Customer 14 Oktober',
            'field_three' => 'Aneka Jaya',
            'confidence' => 0.95,
            'first_seen_at' => $detectedPhysicalTime,
            'last_seen_at' => $detectedPhysicalTime,
            'created_at' => $detectedPhysicalTime,
            'review_status' => 'pending',
            'slm_status' => 'unavailable',
            'packing_completed_at' => null,
        ]);

        Config::set('cctv.auto_sync_packing', true);
        Config::set('cctv.slm_lookup_path', '/api/cctv/labels/lookup');

        Http::fake([
            'https://slm.playgo.id/api/cctv/labels/lookup' => Http::response([
                'matched' => true,
                'customer_name' => 'Customer 14 Oktober Terverifikasi',
                'reference' => 'REF-MATCH-14',
            ], 200),
        ]);

        app(\App\Services\SlmMatcher::class)->match($label);

        $fresh = $label->fresh();
        $this->assertEquals('matched', $fresh->slm_status);
        $this->assertNotNull($fresh->packing_completed_at);
        $this->assertEquals($detectedPhysicalTime->toIso8601String(), $fresh->packing_completed_at->toIso8601String());
        $this->assertNotEquals(now()->format('Y-m-d'), $fresh->packing_completed_at->format('Y-m-d'));
    }

    public function test_repair_label_timestamps_command_fixes_inconsistent_timestamps(): void
    {
        $camera = Camera::create(['name' => 'Meja Packing 3', 'stream_env_key' => 'CCTV_URL']);
        $detectedPhysicalTime = \Carbon\Carbon::parse('2026-10-14 11:00:00');

        $label = LabelRecord::create([
            'camera_id' => $camera->id,
            'field_one' => '141026-03',
            'field_two' => 'Customer Salah Timestamp',
            'field_three' => 'Aneka Jaya',
            'confidence' => 0.95,
            'first_seen_at' => $detectedPhysicalTime,
            'last_seen_at' => $detectedPhysicalTime,
            'created_at' => $detectedPhysicalTime,
            'review_status' => 'auto_read',
            'slm_status' => 'matched',
            'packing_completed_at' => now(),
            'packing_completed_by' => null,
        ]);

        $this->artisan('cctv:repair-label-timestamps --dry-run')
            ->expectsOutputToContain('Total label diperbaiki: 1 (dry-run mode)')
            ->assertExitCode(0);
        $this->assertNotEquals($detectedPhysicalTime->toIso8601String(), $label->fresh()->packing_completed_at->toIso8601String());

        $this->artisan('cctv:repair-label-timestamps')
            ->expectsOutputToContain('Total label diperbaiki: 1')
            ->assertExitCode(0);

        $this->assertEquals($detectedPhysicalTime->toIso8601String(), $label->fresh()->packing_completed_at->toIso8601String());
    }
}

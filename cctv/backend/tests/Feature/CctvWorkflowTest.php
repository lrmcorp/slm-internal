<?php

namespace Tests\Feature;

use App\Jobs\SendIncidentNotification;
use App\Jobs\SyncMatchedLabelToSlm;
use App\Jobs\VerifyLabelWithAi;
use App\Models\Camera;
use App\Models\Incident;
use App\Models\LabelRecord;
use App\Models\User;
use App\Services\SlmMatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class CctvWorkflowTest extends TestCase
{
    use RefreshDatabase;

    private function snapshot(): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('frame.png', base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9ZkAAAAASUVORK5CYII='
        ));
    }

    private function clip(): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('clip.mp4',
            "\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom");
    }

    private function camera(): Camera
    {
        return Camera::create(['name' => 'Dus A', 'location' => 'Toko', 'stream_env_key' => 'CCTV_CAMERA_1_URL']);
    }

    public function test_label_preserves_leading_zero_and_first_seen_time_and_marks_uncertain_read(): void
    {
        Storage::fake('local');
        config(['cctv.ingest_token' => str_repeat('a', 64)]);
        $camera = $this->camera();
        $url = "/api/ingest/cameras/{$camera->id}/labels";
        $fields = ['field_one' => '061026-23', 'field_two' => 'TK HANSEL ASK', 'field_three' => 'MJ',
            'confidence' => 0.61, 'observed_at' => '2026-10-06T10:00:00Z'];

        $this->post($url, $fields + ['snapshot' => $this->snapshot()], ['X-CCTV-Ingest-Token' => str_repeat('a', 64)])
            ->assertCreated();
        $this->post($url, array_merge($fields, ['observed_at' => '2026-10-06T10:01:00Z',
            'snapshot' => $this->snapshot()]), ['X-CCTV-Ingest-Token' => str_repeat('a', 64)])->assertOk();

        $this->assertDatabaseCount('labels', 1);
        $this->assertDatabaseHas('labels', ['field_one' => '061026-23', 'review_status' => 'needs_review',
            'slm_status' => 'unavailable', 'first_seen_at' => '2026-10-06 10:00:00',
            'last_seen_at' => '2026-10-06 10:01:00']);
        $label = LabelRecord::first();
        $user = User::factory()->create();
        $this->actingAs($user)->get("/labels/{$label->id}")->assertOk()->assertSee('PEMERIKSAAN BUKTI PACKING');
        $this->actingAs($user)->post("/labels/{$label->id}/review", [
            'status' => 'confirmed', 'field_one' => '061026-23',
            'field_two' => 'TK HANSEL ASK', 'field_three' => 'MJ',
        ])->assertRedirect();
        $this->assertDatabaseHas('labels', ['id' => $label->id, 'field_one' => '061026-23',
            'review_status' => 'confirmed', 'first_seen_at' => '2026-10-06 10:00:00']);
    }

    public function test_slm_string_false_is_not_a_confirmed_match(): void
    {
        config(['cctv.slm_base_url' => 'https://slm.example', 'cctv.slm_token' => 'test-token']);
        Http::fake(['slm.example/*' => Http::response(['matched' => 'false'])]);
        $label = LabelRecord::create(['camera_id' => $this->camera()->id, 'field_one' => '061026-23',
            'field_two' => 'TK HANSEL ASK', 'field_three' => 'MJ', 'confidence' => 1,
            'first_seen_at' => now(), 'last_seen_at' => now()]);
        app(SlmMatcher::class)->match($label);
        $this->assertSame('error', $label->fresh()->slm_status);
    }

    public function test_invoice_only_qr_requires_review_even_when_decoding_is_confident(): void
    {
        Storage::fake('local');
        Http::fake();
        config(['cctv.ingest_token' => str_repeat('a', 64), 'cctv.ai_api_key' => null]);
        $camera = $this->camera();
        $this->post("/api/ingest/cameras/{$camera->id}/labels", [
            'field_one' => '061026-23', 'confidence' => 1,
            'raw_ocr' => 'QR: 061026-23', 'observed_at' => '2026-10-08T07:00:00Z',
            'snapshot' => $this->snapshot(),
        ], ['X-CCTV-Ingest-Token' => str_repeat('a', 64)])->assertCreated();
        $this->assertDatabaseHas('labels', ['field_one' => '061026-23', 'field_two' => null,
            'field_three' => null, 'review_status' => 'needs_review', 'slm_status' => 'unavailable']);
        Storage::disk('local')->assertExists(LabelRecord::first()->evidence_path);
        Http::assertNothingSent();
    }

    public function test_sketch_placeholder_sip_is_not_automatically_matched(): void
    {
        Storage::fake('local');
        config(['cctv.ingest_token' => str_repeat('a', 64)]);
        $camera = $this->camera();
        $this->post("/api/ingest/cameras/{$camera->id}/labels", [
            'field_one' => '061026-23', 'field_two' => 'TK HANSEL ASK',
            'field_three' => 'SIP', 'confidence' => .99,
            'observed_at' => '2026-10-07T07:00:00Z', 'snapshot' => $this->snapshot(),
        ], ['X-CCTV-Ingest-Token' => str_repeat('a', 64)])->assertCreated();
        $this->assertDatabaseHas('labels', ['field_three' => 'SIP',
            'review_status' => 'needs_review', 'slm_status' => 'unavailable']);
    }

    public function test_anomaly_requires_approved_zones_deduplicates_and_queues_one_notification(): void
    {
        Storage::fake('local');
        Queue::fake();
        config(['cctv.ingest_token' => str_repeat('a', 64)]);
        $camera = $this->camera();
        $user = User::factory()->create();
        DB::table('notification_rules')->insert(['user_id' => $user->id, 'incident_type' => 'anomaly',
            'channel' => 'push', 'enabled' => true, 'created_at' => now(), 'updated_at' => now()]);
        $fields = ['source_event_id' => 'tracking-123', 'type' => 'anomaly',
            'occurred_at' => '2026-10-06T10:00:00Z', 'reason' => 'Objek melewati batas.',
            'item_count' => 2, 'exited_boundary' => true, 'passed_packing_route' => false];
        $url = "/api/ingest/cameras/{$camera->id}/incidents";
        $headers = ['X-CCTV-Ingest-Token' => str_repeat('a', 64)];

        $this->post($url, $fields + ['snapshot' => $this->snapshot(), 'clip' => $this->clip()], $headers)
            ->assertUnprocessable();
        $camera->update(['zones' => [['type' => 'store_boundary', 'points' => [[0, 0], [1, 0], [1, 1]]]],
            'zones_approved_at' => now(), 'zones_approved_by' => $user->id]);
        $this->post($url, $fields + ['snapshot' => $this->snapshot()], $headers)
            ->assertCreated();
        $this->post("/api/ingest/cameras/{$camera->id}/incidents/tracking-123/clip",
            ['clip' => $this->clip()], $headers)->assertOk();
        $this->post($url, $fields + ['snapshot' => $this->snapshot(), 'clip' => $this->clip()], $headers)
            ->assertOk();

        $this->assertDatabaseCount('incidents', 1);
        $this->assertDatabaseCount('notification_deliveries', 1);
        Queue::assertPushed(SendIncidentNotification::class, 1);
        $incident = DB::table('incidents')->first();
        $this->assertNotNull($incident->clip_path);
        $this->actingAs($user)->post("/incidents/{$incident->id}/review",
            ['status' => 'dismissed', 'note' => 'Alur normal'])->assertRedirect();
        $this->assertDatabaseHas('incidents', ['id' => $incident->id, 'status' => 'dismissed']);
    }

    public function test_camera_danger_zone_can_be_drafted_without_enabling_detection(): void
    {
        Storage::fake('local');
        $camera = $this->camera();
        $admin = User::factory()->create(['is_admin' => true]);
        $this->actingAs($admin)->post("/cameras/{$camera->id}/reference",
            ['image' => $this->snapshot()])->assertRedirect();
        $draft = ['zones' => [
            ['type' => 'packing_area', 'points' => [[.35, .2], [.53, .2], [.54, .99], [.3, .99]]],
            ['type' => 'danger_zone', 'points' => [[0, .2], [.33, .2], [.15, .99], [0, .99]]],
        ]];
        $this->actingAs($admin)->putJson("/cameras/{$camera->id}/zones", $draft)->assertOk();
        $this->assertNull($camera->fresh()->zones_approved_at);
        $this->actingAs($admin)->post("/cameras/{$camera->id}/zones/approve")->assertUnprocessable();
        $this->actingAs($admin)->get("/cameras/{$camera->id}")->assertOk()
            ->assertSee('Draf tersimpan');
    }

    public function test_ingest_and_evidence_require_authentication(): void
    {
        $camera = $this->camera();
        $this->post("/api/ingest/cameras/{$camera->id}/heartbeat", ['status' => 'online'])->assertUnauthorized();
        $this->get('/api/incidents')->assertUnauthorized();
        $this->get('/evidence/incident-snapshot/1')->assertRedirect('/login');
    }

    public function test_offline_health_alert_is_deduplicated_and_whatsapp_delivery_uses_official_template(): void
    {
        Queue::fake();
        $camera = $this->camera();
        $camera->update(['status' => 'online', 'last_seen_at' => now()->subMinutes(3)]);
        $user = User::factory()->create();
        DB::table('notification_rules')->insert(['user_id' => $user->id, 'incident_type' => 'worker_offline',
            'channel' => 'whatsapp', 'enabled' => true, 'whatsapp_number' => '+6281234567890',
            'created_at' => now(), 'updated_at' => now()]);
        $this->artisan('cctv:check-health')->assertSuccessful();
        $this->artisan('cctv:check-health')->assertSuccessful();
        $this->assertDatabaseCount('incidents', 1);
        $this->assertDatabaseCount('notification_deliveries', 1);

        config(['cctv.wa_phone_number_id' => '123', 'cctv.wa_access_token' => 'test-token',
            'cctv.wa_template_name' => 'cctv_alert']);
        Http::fake(['graph.facebook.com/*' => Http::response(['messages' => [['id' => 'wamid.test']]], 200)]);
        $delivery = DB::table('notification_deliveries')->first();
        (new SendIncidentNotification($delivery->id))->handle();
        $this->assertDatabaseHas('notification_deliveries', ['id' => $delivery->id, 'status' => 'sent', 'attempts' => 1]);
        Http::assertSent(fn ($request) => $request->url() === 'https://graph.facebook.com/v23.0/123/messages'
            && $request['type'] === 'template' && $request['to'] === '6281234567890');
    }

    public function test_admin_selects_notification_recipient_and_regular_user_cannot_change_it(): void
    {
        $admin = User::factory()->create(['is_admin' => true]);
        $recipient = User::factory()->create();
        $this->actingAs($admin)->get('/')->assertOk()->assertSee('Ringkasan Pemantauan');
        $data = ['user_id' => $recipient->id, 'incident_type' => 'anomaly',
            'channel' => 'push', 'enabled' => true];
        $this->actingAs($admin)->post('/notification-rules', $data)->assertRedirect();
        $this->assertDatabaseHas('notification_rules', ['user_id' => $recipient->id, 'incident_type' => 'anomaly']);
        $this->actingAs($recipient)->post('/notification-rules', array_merge($data,
            ['user_id' => $admin->id, 'incident_type' => 'worker_offline']))->assertRedirect();
        $this->assertDatabaseHas('notification_rules', ['user_id' => $recipient->id, 'incident_type' => 'worker_offline']);
        $this->assertDatabaseMissing('notification_rules', ['user_id' => $admin->id, 'incident_type' => 'worker_offline']);
        $this->actingAs($recipient)->post('/cameras', ['name' => 'No access',
            'stream_env_key' => 'CCTV_CAMERA_2_URL'])->assertForbidden();
    }

    public function test_fcm_delivery_registers_a_secure_detail_link_and_marks_delivery_sent(): void
    {
        $camera = $this->camera();
        $user = User::factory()->create();
        $incident = Incident::create(['camera_id' => $camera->id, 'type' => 'anomaly',
            'reason' => 'Perlu diperiksa.', 'occurred_at' => now(), 'dedupe_key' => str_repeat('b', 64)]);
        DB::table('notification_deliveries')->insert(['incident_id' => $incident->id, 'user_id' => $user->id,
            'channel' => 'push', 'status' => 'pending', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('device_tokens')->insert(['user_id' => $user->id, 'token_hash' => hash('sha256', 'device-test'),
            'token_encrypted' => encrypt('device-test'), 'platform' => 'android',
            'created_at' => now(), 'updated_at' => now()]);
        $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        openssl_pkey_export($key, $pem);
        $file = tempnam(sys_get_temp_dir(), 'cctv-fcm-');
        file_put_contents($file, json_encode(['project_id' => 'test-project',
            'client_email' => 'test@test-project.iam.gserviceaccount.com', 'private_key' => $pem]));
        try {
            config(['cctv.fcm_project_id' => 'test-project', 'cctv.fcm_service_account_file' => $file]);
            Http::fake(['oauth2.googleapis.com/*' => Http::response(['access_token' => 'test-oauth'], 200),
                'fcm.googleapis.com/*' => Http::response(['name' => 'projects/test/messages/1'], 200)]);
            $delivery = DB::table('notification_deliveries')->first();
            (new SendIncidentNotification($delivery->id))->handle();
            $this->assertDatabaseHas('notification_deliveries', ['id' => $delivery->id, 'status' => 'sent']);
            Http::assertSent(fn ($request) => str_contains($request->url(), 'fcm.googleapis.com')
                && $request['message']['data']['incident_id'] === (string) $incident->id
                && str_contains($request['message']['data']['url'], '/incidents/'.$incident->id));
        } finally {
            unlink($file);
        }
    }

    public function test_ai_api_suggests_uncertain_label_without_overwriting_or_matching_it(): void
    {
        Storage::fake('local');
        Storage::disk('local')->put('cctv/labels/frame.png', base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9ZkAAAAASUVORK5CYII='
        ));
        $label = LabelRecord::create(['camera_id' => $this->camera()->id, 'field_one' => '061026-23',
            'confidence' => .4, 'first_seen_at' => now(), 'last_seen_at' => now(),
            'evidence_path' => 'cctv/labels/frame.png', 'review_status' => 'pending']);
        config(['cctv.ai_api_key' => 'test-key', 'cctv.ai_model' => 'gpt-4.1-mini']);
        Http::fake(['api.openai.com/*' => Http::response(['output' => [[
            'content' => [['type' => 'output_text', 'text' => json_encode([
                'field_one' => '061026-23', 'field_two' => 'TK HANSEL ASK', 'field_three' => 'MJ',
            ])]],
        ]]], 200)]);
        (new VerifyLabelWithAi($label->id))->handle();
        $this->assertDatabaseHas('labels', ['id' => $label->id, 'field_one' => '061026-23',
            'review_status' => 'pending', 'slm_status' => 'unavailable', 'ai_status' => 'suggestion_ready']);
        $this->assertSame('MJ', $label->fresh()->ai_suggestion['field_three']);
        Http::assertSent(fn ($request) => $request->url() === 'https://api.openai.com/v1/responses'
            && $request['store'] === false && $request['model'] === 'gpt-4.1-mini');
    }

    public function test_gemini_vision_suggests_and_completes_label(): void
    {
        Storage::fake('local');
        Storage::disk('local')->put('cctv/labels/frame.png', base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9ZkAAAAASUVORK5CYII='
        ));
        $label = LabelRecord::create(['camera_id' => $this->camera()->id, 'field_one' => '061026-23',
            'confidence' => .4, 'first_seen_at' => now(), 'last_seen_at' => now(),
            'evidence_path' => 'cctv/labels/frame.png', 'review_status' => 'pending']);
        config([
            'cctv.ai_provider' => 'gemini',
            'cctv.ai_api_key' => 'AQ.Ab8RN6LtfOQgKtpQSPaSOYOApthgAyfpB6x65hrn49OVM1gvGQ',
            'cctv.ai_model' => 'gemini-3.5-flash-lite',
        ]);
        Http::fake(['generativelanguage.googleapis.com/*' => Http::response([
            'candidates' => [[
                'content' => [
                    'parts' => [[
                        'text' => json_encode([
                            'field_one' => '061026-23',
                            'field_two' => 'TK HANSEL ASK',
                            'field_three' => 'MJ',
                        ]),
                    ]],
                ],
            ]],
        ], 200)]);
        (new VerifyLabelWithAi($label->id))->handle();
        $fresh = $label->fresh();
        $this->assertSame('suggestion_ready', $fresh->ai_status);
        $this->assertSame('061026-23', $fresh->ai_suggestion['field_one']);
        $this->assertSame('TK HANSEL ASK', $fresh->ai_suggestion['field_two']);
        $this->assertSame('MJ', $fresh->ai_suggestion['field_three']);
        Http::assertSent(fn ($request) => str_contains($request->url(), 'generativelanguage.googleapis.com')
            && str_contains($request->url(), 'gemini-3.5-flash-lite'));
    }

    public function test_slm_lookup_uses_invoice_customer_and_mj_integration_marker(): void
    {
        $label = LabelRecord::create(['camera_id' => $this->camera()->id,
            'field_one' => '061026-23', 'field_two' => 'TK HANSEL ASK', 'field_three' => 'MJ',
            'confidence' => .95, 'first_seen_at' => now(), 'last_seen_at' => now(),
            'review_status' => 'confirmed']);
        config(['cctv.slm_base_url' => 'https://mkr.lrmslm.com',
            'cctv.slm_lookup_path' => '/api/cctv/labels/lookup', 'cctv.slm_token' => 'test-token']);
        Http::fake(['mkr.lrmslm.com/*' => Http::response(['matched' => true, 'reference' => 'INV-1'])]);

        app(SlmMatcher::class)->match($label);

        $this->assertDatabaseHas('labels', ['id' => $label->id, 'slm_status' => 'matched',
            'slm_reference' => 'INV-1', 'slm_sync_status' => 'pending_configuration']);
        Http::assertSent(fn ($request) => $request->url() === 'https://mkr.lrmslm.com/api/cctv/labels/lookup'
            && $request['invoice_number'] === '061026-23'
            && $request['customer_name'] === 'TK HANSEL ASK'
            && $request['source_label'] === 'MJ'
            && $request['integration_marker'] === 'MJ INtegration');

        Queue::fake();
        config(['app.url' => 'https://cctv.example.test',
            'cctv.slm_sync_path' => '/api/cctv/labels/sync']);
        app(SlmMatcher::class)->match($label);
        $this->assertDatabaseHas('labels', ['id' => $label->id, 'slm_sync_status' => 'queued']);
        Queue::assertPushed(SyncMatchedLabelToSlm::class, 1);
    }

    public function test_slm_lookup_dual_strategy_falls_back_to_invoice_only_when_customer_differs(): void
    {
        $label = LabelRecord::create([
            'camera_id' => $this->camera()->id,
            'field_one' => '121026-03',
            'field_two' => 'SIP:Nami Beauty',
            'field_three' => 'Aneka Jaya',
            'confidence' => .95,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
            'review_status' => 'confirmed'
        ]);
        config([
            'cctv.slm_base_url' => 'https://mkr.lrmslm.com',
            'cctv.slm_lookup_path' => '/api/cctv/labels/lookup',
            'cctv.slm_token' => 'test-token',
        ]);
        Http::fake([
            'mkr.lrmslm.com/api/cctv/labels/lookup' => Http::sequence()
                ->push(['matched' => false, 'note' => "Customer tidak cocok: terbaca 'SIP:Nami Beauty', aktual 'Maya'"])
                ->push(['matched' => true, 'reference' => 'S-12345', 'customer_name' => 'Maya', 'packing_status' => 'sudah']),
        ]);

        app(SlmMatcher::class)->match($label);

        $fresh = $label->fresh();
        $this->assertSame('matched', $fresh->slm_status);
        $this->assertSame('S-12345', $fresh->slm_reference);
        $this->assertSame('Maya', $fresh->field_two);
        $this->assertSame('Maya', $fresh->slm_response['customer_name']);
    }

    public function test_matched_label_keeps_private_photo_and_syncs_record_once(): void
    {
        Storage::fake('local');
        Storage::disk('local')->put('cctv/labels/invoice.png', base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9ZkAAAAASUVORK5CYII='
        ));
        $label = LabelRecord::create(['camera_id' => $this->camera()->id,
            'field_one' => '061026-23', 'field_two' => 'TK HANSEL ASK', 'field_three' => 'MJ',
            'confidence' => .95, 'first_seen_at' => now(), 'last_seen_at' => now(),
            'evidence_path' => 'cctv/labels/invoice.png', 'review_status' => 'confirmed',
            'slm_status' => 'matched', 'slm_reference' => 'INV-1']);
        config(['app.url' => 'https://cctv.example.test',
            'cctv.slm_base_url' => 'https://mkr.lrmslm.com',
            'cctv.slm_sync_path' => '/api/cctv/labels/sync', 'cctv.slm_token' => 'test-token',
            'cctv.slm_sync_upload_photo' => false]);
        Http::fake(['mkr.lrmslm.com/*' => Http::response(['saved' => true], 200)]);

        (new SyncMatchedLabelToSlm($label->id))->handle();
        (new SyncMatchedLabelToSlm($label->id))->handle();

        $this->assertDatabaseHas('labels', ['id' => $label->id, 'slm_sync_status' => 'synced']);
        $this->assertTrue(Storage::disk('local')->exists($label->evidence_path));
        Http::assertSent(fn ($request) => $request->url() === 'https://mkr.lrmslm.com/api/cctv/labels/sync'
            && $request['invoice_number'] === '061026-23'
            && $request['customer_name'] === 'TK HANSEL ASK'
            && str_contains($request['evidence_url'], '/api/v1/slm/evidence/label-snapshot/'.$label->id)
            && str_contains($request['evidence_url'], 'token=test-token')
            && $request['dashboard_url'] === 'https://cctv.example.test/labels/'.$label->id);
    }

    public function test_slm_can_receive_photo_when_its_api_contract_requires_it(): void
    {
        Storage::fake('local');
        Storage::disk('local')->put('cctv/labels/invoice.png', base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9ZkAAAAASUVORK5CYII='
        ));
        $label = LabelRecord::create(['camera_id' => $this->camera()->id,
            'field_one' => '061026-23', 'field_two' => 'TK HANSEL ASK', 'field_three' => 'MJ',
            'confidence' => .95, 'first_seen_at' => now(), 'last_seen_at' => now(),
            'evidence_path' => 'cctv/labels/invoice.png', 'review_status' => 'confirmed',
            'slm_status' => 'matched', 'slm_reference' => 'INV-1']);
        config(['app.url' => 'https://cctv.example.test',
            'cctv.slm_base_url' => 'https://mkr.lrmslm.com',
            'cctv.slm_sync_path' => '/api/cctv/labels/sync', 'cctv.slm_token' => 'test-token',
            'cctv.slm_sync_upload_photo' => true]);
        Http::fake(['mkr.lrmslm.com/*' => Http::response(['saved' => true], 200)]);

        (new SyncMatchedLabelToSlm($label->id))->handle();

        $this->assertDatabaseHas('labels', ['id' => $label->id, 'slm_sync_status' => 'synced']);
        Http::assertSent(fn ($request) => $request->isMultipart()
            && $request->url() === 'https://mkr.lrmslm.com/api/cctv/labels/sync');
    }

    public function test_auto_sync_packing_mode_automatically_matches_and_packs_confident_qr(): void
    {
        Storage::fake('local');
        Queue::fake([SyncMatchedLabelToSlm::class]);
        config([
            'cctv.ingest_token' => str_repeat('a', 64),
            'cctv.auto_sync_packing' => true,
            'cctv.slm_base_url' => 'https://mkr.lrmslm.com',
            'cctv.slm_lookup_path' => '/api/cctv/labels/lookup',
            'cctv.slm_sync_path' => '/api/cctv/labels/sync',
            'cctv.slm_token' => 'test-token',
        ]);
        Http::fake([
            'mkr.lrmslm.com/api/cctv/labels/lookup' => Http::response([
                'matched' => true,
                'reference' => 'S-9999',
                'customer_name' => 'TK HANSEL ASK',
                'packing_status' => 'belum',
            ], 200),
        ]);

        $camera = $this->camera();
        $this->post("/api/ingest/cameras/{$camera->id}/labels", [
            'field_one' => '061026-23',
            'confidence' => 1.0,
            'raw_ocr' => 'QR: 061026-23',
            'observed_at' => '2026-10-08T07:00:00Z',
            'snapshot' => $this->snapshot(),
        ], ['X-CCTV-Ingest-Token' => str_repeat('a', 64)])->assertCreated();

        $label = LabelRecord::first();
        $this->assertNotNull($label);
        $this->assertSame('061026-23', $label->field_one);
        $this->assertSame('TK HANSEL ASK', $label->field_two);
        $this->assertSame('Aneka Jaya', $label->field_three);
        $this->assertSame('auto_verified', $label->review_status);
        $this->assertSame('matched', $label->slm_status);
        $this->assertSame('S-9999', $label->slm_reference);
        $this->assertNotNull($label->packing_completed_at);
        $this->assertSame('queued', $label->slm_sync_status);

        Queue::assertPushed(SyncMatchedLabelToSlm::class, fn ($job) => $job->labelId === $label->id);
    }
}


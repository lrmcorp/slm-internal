<?php

namespace Tests\Feature;

use App\Jobs\SyncMatchedLabelToSlm;
use App\Models\Camera;
use App\Models\Incident;
use App\Models\LabelRecord;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class VerificationGatekeeperAndTimestampTest extends TestCase
{
    use RefreshDatabase;

    private function snapshot(): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('frame.jpg', base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9ZkAAAAASUVORK5CYII='
        ));
    }

    private function camera(): Camera
    {
        return Camera::create([
            'name' => 'Camera 14',
            'location' => 'Meja Packing',
            'stream_env_key' => 'CCTV_CAMERA_14_URL',
        ]);
    }

    /**
     * Requirement A: Kunci Timestamp ke Waktu Penangkapan Kamera Fisik
     * Payload webhook & sync ke ERP SLM harus terkunci pada first_seen_at (14 Oktober), BUKAN now() (16 Oktober).
     */
    public function test_webhook_and_sync_payload_locks_timestamp_to_physical_camera_detection_time(): void
    {
        Storage::fake('local');
        $camera = $this->camera();
        $token = 'test-slm-token-12345';
        $disk = Storage::disk('local');
        $photoPath = 'cctv/labels/evidence-32.jpg';
        $disk->put($photoPath, 'binary-image-data');

        $physicalTime = Carbon::parse('2026-10-14T04:21:30+00:00');
        // Simulasikan worker sync/webhook berjalan pada tanggal 16 Oktober
        Carbon::setTestNow(Carbon::parse('2026-10-16T10:00:00+00:00'));

        $label = new LabelRecord([
            'camera_id' => $camera->id,
            'field_one' => '161026-07',
            'field_two' => 'Rohit ask',
            'field_three' => 'Aneka Jaya',
            'confidence' => 0.98,
            'first_seen_at' => $physicalTime,
            'last_seen_at' => $physicalTime,
            'created_at' => $physicalTime,
            'evidence_path' => $photoPath,
            'review_status' => 'auto_verified',
            'slm_status' => 'matched',
            'slm_sync_status' => 'queued',
            'packing_completed_at' => $physicalTime,
        ]);
        $label->id = 32;
        $label->save();

        Config::set('cctv.slm_base_url', 'https://mkr.lrmslm.com');
        Config::set('cctv.slm_sync_path', '/api/cctv/labels/sync');
        Config::set('cctv.slm_token', $token);
        Config::set('app.url', 'http://31.97.51.194:8000');

        $recordedPayload = null;
        Http::fake([
            'https://mkr.lrmslm.com/api/cctv/labels/sync' => function ($request) use (&$recordedPayload) {
                $recordedPayload = $request->data();
                return Http::response(['saved' => true], 200);
            },
        ]);

        $job = new SyncMatchedLabelToSlm($label->id);
        $job->handle();

        $this->assertNotNull($recordedPayload, 'Payload sinkronisasi harus terkirim ke ERP SLM');

        // Pastikan format terstruktur sesuai instruksi ERP SLM:
        $this->assertSame('packing_completed', $recordedPayload['event_type']);
        $this->assertSame('2026-10-14T04:21:30+00:00', $recordedPayload['occurred_at']);
        $this->assertNotSame('2026-10-16T10:00:00+00:00', $recordedPayload['occurred_at']);

        // Data Kamera
        $this->assertSame($camera->id, $recordedPayload['camera']['id']);
        $this->assertSame('Camera 14', $recordedPayload['camera']['name']);
        $this->assertSame('Meja Packing', $recordedPayload['camera']['location']);

        // Data Rincian
        $this->assertSame($label->id, $recordedPayload['data']['label_id']);
        $this->assertSame('161026-07', $recordedPayload['data']['invoice_number']);
        $this->assertSame('Rohit ask', $recordedPayload['data']['customer_name']);
        $this->assertSame('2026-10-14T04:21:30+00:00', $recordedPayload['data']['packing_completed_at']);
        $this->assertSame('2026-10-14T04:21:30+00:00', $recordedPayload['data']['detected_at']);
        $this->assertEquals(0.98, $recordedPayload['data']['confidence']);
        $this->assertStringContainsString('/api/v1/slm/evidence/label-snapshot/' . $label->id, $recordedPayload['data']['evidence_url']);

        Carbon::setTestNow();
    }

    /**
     * Requirement B.1: Confidence >= 0.90 dan Invoice Utuh -> auto_verified & Masuk Antrean SLM
     */
    public function test_high_confidence_and_valid_invoice_marks_auto_verified_and_enqueues_sync(): void
    {
        Storage::fake('local');
        Queue::fake();
        $camera = $this->camera();
        $ingestToken = str_repeat('a', 64);
        Config::set('cctv.ingest_token', $ingestToken);
        Config::set('cctv.min_confidence', 0.90);
        Config::set('cctv.auto_sync_packing', true);
        Config::set('cctv.slm_base_url', 'https://mkr.lrmslm.com');
        Config::set('cctv.slm_lookup_path', '/api/cctv/labels/lookup');
        Config::set('cctv.slm_sync_path', '/api/cctv/labels/sync');
        Config::set('cctv.slm_token', 'test-token');

        Http::fake([
            'https://mkr.lrmslm.com/api/cctv/labels/lookup' => Http::response([
                'matched' => true,
                'customer_name' => 'Rohit ask',
                'reference' => 'REF-161026',
            ], 200),
        ]);

        $response = $this->withHeaders(['X-CCTV-Ingest-Token' => $ingestToken])
            ->post("/api/ingest/cameras/{$camera->id}/labels", [
                'field_one' => '161026-07',
                'field_two' => 'Rohit ask',
                'field_three' => 'Aneka Jaya',
                'confidence' => 0.98, // >= 0.90
                'observed_at' => '2026-10-14T04:21:30Z',
                'snapshot' => $this->snapshot(),
            ]);

        $response->assertCreated();

        $label = LabelRecord::where('field_one', '161026-07')->first();
        $this->assertNotNull($label);
        $this->assertSame('auto_verified', $label->review_status, 'Confidence 0.98 harus berstatus auto_verified');
        $label = $this->runMatchJob($label);
        $this->assertSame('matched', $label->slm_status);
        $this->assertSame('queued', $label->slm_sync_status, 'Harus masuk antrean sinkronisasi ERP SLM');

        // Tidak boleh ada incident manual review jika auto_verified
        $this->assertDatabaseMissing('incidents', [
            'camera_id' => $camera->id,
            'type' => 'label_needs_review',
        ]);

        Queue::assertPushed(SyncMatchedLabelToSlm::class, fn ($job) => $job->labelId === $label->id);
    }

    /**
     * Requirement B.1: Confidence < 0.90 -> needs_review, JANGAN kirim ke SLM, buat Incident
     */
    public function test_low_confidence_marks_needs_review_blocks_erp_sync_and_creates_incident(): void
    {
        Storage::fake('local');
        Queue::fake();
        $camera = $this->camera();
        $ingestToken = str_repeat('a', 64);
        Config::set('cctv.ingest_token', $ingestToken);
        Config::set('cctv.min_confidence', 0.90);
        Config::set('cctv.auto_sync_packing', true);
        Config::set('cctv.slm_base_url', 'https://mkr.lrmslm.com');
        Config::set('cctv.slm_lookup_path', '/api/cctv/labels/lookup');
        Config::set('cctv.slm_sync_path', '/api/cctv/labels/sync');
        Config::set('cctv.slm_token', 'test-token');

        $response = $this->withHeaders(['X-CCTV-Ingest-Token' => $ingestToken])
            ->post("/api/ingest/cameras/{$camera->id}/labels", [
                'field_one' => '161026-07',
                'field_two' => 'Rohit ask (buram)',
                'field_three' => 'Aneka Jaya',
                'confidence' => 0.85, // < 0.90 ambang batas
                'observed_at' => '2026-10-14T04:21:30Z',
                'snapshot' => $this->snapshot(),
            ]);

        $response->assertCreated();

        $label = LabelRecord::where('field_one', '161026-07')->first();
        $this->assertNotNull($label);
        $this->assertSame('needs_review', $label->review_status, 'Confidence 0.85 harus berstatus needs_review');
        $this->assertNull($label->packing_completed_at, 'JANGAN auto-pack label dengan confidence rendah');
        $this->assertSame('not_ready', $label->slm_sync_status, 'JANGAN kirim ke antrean ERP');

        // Pastikan tercatat di tabel incidents untuk review operator
        $incident = Incident::where('camera_id', $camera->id)
            ->where('type', 'label_needs_review')
            ->first();
        $this->assertNotNull($incident, 'Incident label_needs_review harus dibuat untuk operator');
        $this->assertSame('needs_review', $incident->status);
        $this->assertEquals(0.85, (float) $incident->confidence);
        $this->assertSame($label->id, $incident->metadata['label_id']);

        // JANGAN kirim ke ERP SLM
        Queue::assertNothingPushed();
    }

    /**
     * Requirement B.1: Setelah Disetujui Manual Operator (Confirmed), Baru Kirim ke SLM dengan Timestamp Fisik
     */
    public function test_manually_approved_label_syncs_with_original_camera_capture_timestamp(): void
    {
        Storage::fake('local');
        Queue::fake();
        $camera = $this->camera();
        $user = User::factory()->create();

        $physicalTime = Carbon::parse('2026-10-14T04:21:30+00:00');
        // Operator mereview 2 hari kemudian (16 Oktober)
        Carbon::setTestNow(Carbon::parse('2026-10-16T11:00:00+00:00'));

        $label = LabelRecord::create([
            'camera_id' => $camera->id,
            'field_one' => '161026-07',
            'field_two' => 'Rohit ask',
            'field_three' => 'Aneka Jaya',
            'confidence' => 0.85,
            'first_seen_at' => $physicalTime,
            'last_seen_at' => $physicalTime,
            'created_at' => $physicalTime,
            'review_status' => 'needs_review',
            'slm_status' => 'unavailable',
            'slm_sync_status' => 'not_ready',
        ]);

        $incident = Incident::create([
            'camera_id' => $camera->id,
            'type' => 'label_needs_review',
            'status' => 'needs_review',
            'reason' => 'Perlu review',
            'occurred_at' => $physicalTime,
            'dedupe_key' => 'dedupe-test-review',
            'metadata' => ['label_id' => $label->id],
        ]);

        Config::set('cctv.slm_base_url', 'https://mkr.lrmslm.com');
        Config::set('cctv.slm_lookup_path', '/api/cctv/labels/lookup');
        Config::set('cctv.slm_sync_path', '/api/cctv/labels/sync');
        Config::set('cctv.slm_token', 'test-token');

        Http::fake([
            'https://mkr.lrmslm.com/api/cctv/labels/lookup' => Http::response([
                'matched' => true,
                'customer_name' => 'Rohit ask Terkonfirmasi',
                'reference' => 'REF-OK-16',
            ], 200),
        ]);

        // Operator melakukan verifikasi manual (menyetujui)
        $response = $this->actingAs($user)->post("/labels/{$label->id}/review", [
            'status' => 'confirmed',
            'field_one' => '161026-07',
            'field_two' => 'Rohit ask',
            'field_three' => 'Aneka Jaya',
            'note' => 'Disetujui operator setelah melihat dus fisik',
        ]);

        $response->assertRedirect();

        $fresh = $label->fresh();
        $this->assertSame('confirmed', $fresh->review_status);
        $this->assertSame('matched', $fresh->slm_status);
        $this->assertSame('queued', $fresh->slm_sync_status);

        // Incident otomatis ter-resolve
        $this->assertSame('confirmed', $incident->fresh()->status);
        $this->assertNotNull($incident->fresh()->resolved_at);

        // Job sync terdorong ke antrean
        Queue::assertPushed(SyncMatchedLabelToSlm::class, fn ($job) => $job->labelId === $label->id);

        Carbon::setTestNow();
    }

    /**
     * Requirement B.2: Pengecekan Dwell Time (Waktu Keberadaan Paket di Meja Packing)
     * Paket yang hanya melintas sekejap (dwell < min_dwell_seconds) TIDAK BOLEH auto-packing.
     */
    public function test_dwell_time_gatekeeper_prevents_instant_passing_objects_from_triggering_packing(): void
    {
        Storage::fake('local');
        Queue::fake();
        $camera = $this->camera();
        $ingestToken = str_repeat('a', 64);
        Config::set('cctv.ingest_token', $ingestToken);
        Config::set('cctv.min_confidence', 0.90);
        Config::set('cctv.min_dwell_seconds', 3); // Minimal 3 detik berada di meja
        Config::set('cctv.auto_sync_packing', true);
        Config::set('cctv.slm_base_url', 'https://mkr.lrmslm.com');
        Config::set('cctv.slm_lookup_path', '/api/cctv/labels/lookup');
        Config::set('cctv.slm_token', 'test-token');

        Http::fake([
            'https://mkr.lrmslm.com/api/cctv/labels/lookup' => Http::response([
                'matched' => true,
                'customer_name' => 'Rohit ask',
                'reference' => 'REF-DWELL',
            ], 200),
        ]);

        // Frame 1: Objek baru pertama kali lewat di t = 0 (dwell = 0 detik)
        $t0 = '2026-10-14T04:21:30Z';
        $this->withHeaders(['X-CCTV-Ingest-Token' => $ingestToken])
            ->post("/api/ingest/cameras/{$camera->id}/labels", [
                'field_one' => '161026-07',
                'field_two' => 'Rohit ask',
                'field_three' => 'Aneka Jaya',
                'confidence' => 0.95,
                'observed_at' => $t0,
                'snapshot' => $this->snapshot(),
                'dwell_seconds' => 0,
            ])->assertCreated();

        $label = LabelRecord::where('field_one', '161026-07')->first();
        $this->assertNotNull($label);
        $this->assertSame('auto_verified', $label->review_status);
        $label = $this->runMatchJob($label);
        $this->assertSame('matched', $label->slm_status);
        // Karena dwell time baru 0 detik (< 3 detik), packing_completed_at TIDAK boleh diset
        $this->assertNull($label->packing_completed_at, 'Objek melintas sekejap tidak boleh langsung packing_completed');

        // Frame 2: Objek masih berada di meja pada t = 4 detik (dwell = 4 detik >= 3 detik)
        $t1 = Carbon::parse($t0)->addSeconds(4)->toIso8601String();
        $this->withHeaders(['X-CCTV-Ingest-Token' => $ingestToken])
            ->post("/api/ingest/cameras/{$camera->id}/labels", [
                'field_one' => '161026-07',
                'field_two' => 'Rohit ask',
                'field_three' => 'Aneka Jaya',
                'confidence' => 0.96,
                'observed_at' => $t1,
                'snapshot' => $this->snapshot(),
                'dwell_seconds' => 4,
            ])->assertOk();

        $fresh = $this->runMatchJob($label, 4);
        // Sekarang dwell time sudah terpenuhi (>= 3 detik), packing_completed_at aktif!
        $this->assertNotNull($fresh->packing_completed_at, 'Packing completed harus aktif setelah dwell time terpenuhi');
        // Dan timestamp tetap menggunakan waktu deteksi fisik asli ($t0)
        $this->assertEquals(Carbon::parse($t0)->toIso8601String(), $fresh->packing_completed_at->toIso8601String());
    }

    public function test_async_slm_match_dispatches_match_label_to_slm_job(): void
    {
        Storage::fake('local');
        Queue::fake();
        $camera = $this->camera();
        $ingestToken = str_repeat('a', 64);
        Config::set('cctv.ingest_token', $ingestToken);
        Config::set('cctv.min_confidence', 0.90);

        $response = $this->withHeaders(['X-CCTV-Ingest-Token' => $ingestToken])
            ->post("/api/ingest/cameras/{$camera->id}/labels", [
                'field_one' => '201026-99',
                'field_two' => 'Toko Baru',
                'field_three' => 'Aneka Jaya',
                'confidence' => 0.95,
                'observed_at' => '2026-10-20T10:00:00Z',
                'snapshot' => $this->snapshot(),
            ]);

        $response->assertCreated();
        $label = LabelRecord::where('field_one', '201026-99')->first();
        $this->assertNotNull($label);
        $this->assertSame('auto_verified', $label->review_status);

        Queue::assertPushed(\App\Jobs\MatchLabelToSlm::class, fn ($job) => $job->labelId === $label->id);
    }

    public function test_resighting_a_matched_and_packed_label_does_not_queue_another_erp_lookup(): void
    {
        Storage::fake('local');
        Queue::fake();
        $camera = $this->camera();
        $ingestToken = str_repeat('a', 64);
        Config::set('cctv.ingest_token', $ingestToken);
        Config::set('cctv.min_confidence', 0.90);
        $send = fn (string $at) => $this->withHeaders(['X-CCTV-Ingest-Token' => $ingestToken])
            ->post("/api/ingest/cameras/{$camera->id}/labels", [
                'field_one' => '201026-55', 'field_two' => 'Toko Baru', 'field_three' => 'Aneka Jaya',
                'confidence' => 0.95, 'observed_at' => $at, 'snapshot' => $this->snapshot(),
            ])->assertSuccessful();

        $send('2026-10-20T10:00:00Z');
        $label = LabelRecord::where('field_one', '201026-55')->firstOrFail();
        $label->update(['slm_status' => 'matched', 'packing_completed_at' => '2026-10-20T10:00:00Z']);

        $send('2026-10-20T10:00:10Z');
        $send('2026-10-20T10:00:20Z');

        Queue::assertPushed(\App\Jobs\MatchLabelToSlm::class, 1);
    }
}

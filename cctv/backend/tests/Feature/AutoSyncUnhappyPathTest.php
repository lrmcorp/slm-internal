<?php

namespace Tests\Feature;

use App\Jobs\SyncMatchedLabelToSlm;
use App\Models\Camera;
use App\Models\LabelRecord;
use App\Services\SlmMatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class AutoSyncUnhappyPathTest extends TestCase
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
        return Camera::create(['name' => 'Meja Packing 14', 'stream_env_key' => 'CCTV_CAMERA_14_URL']);
    }

    /**
     * UNHAPPY PATH 1: Invoice Tidak Terdaftar di ERP SLM (matched: false)
     * Sistem TIDAK BOLEH auto-pack dan TIDAK BOLEH sync jika invoice tidak terdaftar.
     */
    public function test_unhappy_path_invoice_not_found_in_erp_does_not_auto_pack_or_sync(): void
    {
        Storage::fake('local');
        Queue::fake();
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
                'matched' => false,
                'reference' => null,
                'note' => 'Invoice 999999-99 tidak ditemukan di sistem ERP',
            ], 200),
        ]);

        $camera = $this->camera();
        $this->post("/api/ingest/cameras/{$camera->id}/labels", [
            'field_one' => '999999-99',
            'confidence' => 1.0,
            'raw_ocr' => 'QR: 999999-99',
            'observed_at' => '2026-10-12T10:00:00Z',
            'snapshot' => $this->snapshot(),
        ], ['X-CCTV-Ingest-Token' => str_repeat('a', 64)])->assertCreated();

        $label = LabelRecord::first();
        $this->assertNotNull($label);
        $label = $this->runMatchJob($label);
        $this->assertSame('not_found', $label->slm_status);
        $this->assertNull($label->packing_completed_at, 'Packing TIDAK boleh diset selesai jika invoice tidak ada di ERP');
        $this->assertSame('not_ready', $label->slm_sync_status);
        Queue::assertNotPushed(\App\Jobs\SyncMatchedLabelToSlm::class);
    }

    /**
     * UNHAPPY PATH 2: ERP SLM Mengalami HTTP 500 / Network Error saat Lookup
     * Sistem harus menangani kegagalan jaringan secara aman tanpa crash.
     */
    public function test_unhappy_path_erp_server_error_lookup_fails_safely(): void
    {
        Storage::fake('local');
        Queue::fake();
        config([
            'cctv.ingest_token' => str_repeat('a', 64),
            'cctv.auto_sync_packing' => true,
            'cctv.slm_base_url' => 'https://mkr.lrmslm.com',
            'cctv.slm_lookup_path' => '/api/cctv/labels/lookup',
            'cctv.slm_token' => 'test-token',
        ]);
        Http::fake([
            'mkr.lrmslm.com/api/cctv/labels/lookup' => Http::response('Internal Server Error', 500),
        ]);

        $camera = $this->camera();
        $this->post("/api/ingest/cameras/{$camera->id}/labels", [
            'field_one' => '061026-23',
            'confidence' => 1.0,
            'observed_at' => '2026-10-12T10:00:00Z',
            'snapshot' => $this->snapshot(),
        ], ['X-CCTV-Ingest-Token' => str_repeat('a', 64)])->assertCreated();

        $label = LabelRecord::first();
        $this->assertNotNull($label);
        $label = $this->runMatchJob($label);
        $this->assertSame('error', $label->slm_status);
        $this->assertNull($label->packing_completed_at);
        $this->assertSame('not_ready', $label->slm_sync_status);
        Queue::assertNotPushed(\App\Jobs\SyncMatchedLabelToSlm::class);
    }

    /**
     * UNHAPPY PATH 3: Frame Kamera Meja Mengirimkan Burst Deteksi Berulang
     * Deduplikasi harus mencegah duplikasi data invoice dan job sync.
     */
    public function test_unhappy_path_camera_frame_burst_deduplicates_within_five_minutes(): void
    {
        Storage::fake('local');
        Queue::fake();
        config([
            'cctv.ingest_token' => str_repeat('a', 64),
            'cctv.auto_sync_packing' => true,
            'cctv.slm_base_url' => 'https://mkr.lrmslm.com',
            'cctv.slm_token' => 'test-token',
        ]);
        Http::fake([
            'mkr.lrmslm.com/api/cctv/labels/lookup' => Http::response([
                'matched' => true,
                'customer_name' => 'TK HANSEL ASK',
                'reference' => 'S-1',
            ], 200),
        ]);

        $camera = $this->camera();
        $url = "/api/ingest/cameras/{$camera->id}/labels";
        $headers = ['X-CCTV-Ingest-Token' => str_repeat('a', 64)];

        // Kirim 5 kali berturut-turut dalam 1 menit
        for ($i = 0; $i < 5; $i++) {
            $this->post($url, [
                'field_one' => '061026-23',
                'confidence' => 1.0,
                'observed_at' => "2026-10-12T10:00:0{$i}Z",
                'snapshot' => $this->snapshot(),
            ], $headers);
        }

        $this->assertDatabaseCount('labels', 1);
        $label = LabelRecord::first();
        $this->assertSame('2026-10-12 10:00:00', $label->first_seen_at->toDateTimeString());
        $this->assertSame('2026-10-12 10:00:04', $label->last_seen_at->toDateTimeString());
    }

    /**
     * UNHAPPY PATH 4: File Foto Bukti Fisik Hilang dari Disk Sebelum Sync
     * Job sync harus menandai status 'missing_photo' tanpa crash dan tanpa mengirim request kosong ke ERP.
     */
    public function test_unhappy_path_missing_evidence_photo_stops_sync_with_missing_photo_status(): void
    {
        Storage::fake('local');
        Http::fake();
        config([
            'cctv.slm_base_url' => 'https://mkr.lrmslm.com',
            'cctv.slm_sync_path' => '/api/cctv/labels/sync',
            'cctv.slm_token' => 'test-token',
            'app.url' => 'http://cctv.test',
        ]);

        $camera = $this->camera();
        $label = LabelRecord::create([
            'camera_id' => $camera->id,
            'field_one' => '061026-23',
            'field_two' => 'TK HANSEL ASK',
            'field_three' => 'Aneka Jaya',
            'confidence' => 1.0,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
            'evidence_path' => 'cctv/labels/non_existent_file.jpg',
            'review_status' => 'auto_read',
            'slm_status' => 'matched',
            'slm_reference' => 'S-1',
            'packing_completed_at' => now(),
            'slm_sync_status' => 'queued',
        ]);

        (new SyncMatchedLabelToSlm($label->id))->handle();

        $fresh = $label->fresh();
        $this->assertSame('missing_photo', $fresh->slm_sync_status);
        $this->assertSame('Gambar bukti label tidak ditemukan di penyimpanan privat.', $fresh->slm_sync_error);
        Http::assertNothingSent();
    }

    /**
     * UNHAPPY PATH 5: ERP SLM Menolak Simpan (saved: false / HTTP 500) saat Sync
     * Job harus melempar exception agar worker mencoba ulang, dan status failed mengupdate error.
     */
    public function test_unhappy_path_erp_rejects_sync_triggers_retry_and_error_handling(): void
    {
        Storage::fake('local');
        Storage::disk('local')->put('cctv/labels/label-1.jpg', 'fake-image-content');

        config([
            'cctv.slm_base_url' => 'https://mkr.lrmslm.com',
            'cctv.slm_sync_path' => '/api/cctv/labels/sync',
            'cctv.slm_token' => 'test-token',
            'app.url' => 'http://cctv.test',
            'cctv.slm_sync_upload_photo' => true,
        ]);

        Http::fake([
            'mkr.lrmslm.com/api/cctv/labels/sync' => Http::response([
                'saved' => false,
                'error' => 'Database constraint violation',
            ], 200),
        ]);

        $camera = $this->camera();
        $label = LabelRecord::create([
            'camera_id' => $camera->id,
            'field_one' => '061026-23',
            'field_two' => 'TK HANSEL ASK',
            'field_three' => 'Aneka Jaya',
            'confidence' => 1.0,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
            'evidence_path' => 'cctv/labels/label-1.jpg',
            'review_status' => 'auto_read',
            'slm_status' => 'matched',
            'slm_reference' => 'S-1',
            'packing_completed_at' => now(),
            'slm_sync_status' => 'queued',
        ]);

        $job = new SyncMatchedLabelToSlm($label->id);

        $thrown = false;
        try {
            $job->handle();
        } catch (\RuntimeException $e) {
            $thrown = true;
            $this->assertStringContainsString('SLM belum mengonfirmasi penyimpanan', $e->getMessage());
            $job->failed($e);
        }

        $this->assertTrue($thrown, 'Job harus melempar exception bila saved !== true');
        $this->assertSame('error', $label->fresh()->slm_sync_status);
        $this->assertNotNull($label->fresh()->slm_sync_error);
    }

    /**
     * UNHAPPY PATH 6: Deteksi Low Confidence (< 0.8) Tidak Boleh Auto-Pack
     * Hanya deteksi yakin yang boleh otomatis dipacking dan disinkronkan.
     */
    public function test_unhappy_path_low_confidence_detection_stays_pending_and_does_not_auto_pack(): void
    {
        Storage::fake('local');
        Queue::fake();
        config([
            'cctv.ingest_token' => str_repeat('a', 64),
            'cctv.auto_sync_packing' => true,
            'cctv.ai_api_key' => null,
        ]);

        $camera = $this->camera();
        $this->post("/api/ingest/cameras/{$camera->id}/labels", [
            'field_one' => '061026-23',
            'confidence' => 0.55,
            'observed_at' => '2026-10-12T10:00:00Z',
            'snapshot' => $this->snapshot(),
        ], ['X-CCTV-Ingest-Token' => str_repeat('a', 64)])->assertCreated();

        $label = LabelRecord::first();
        $this->assertSame('needs_review', $label->review_status);
        $this->assertNull($label->packing_completed_at);
        $this->assertSame('unavailable', $label->slm_status);
        Queue::assertNothingPushed();
    }

    /**
     * UNHAPPY PATH 7: Tanda Toko Palsu/Tidak Valid Ditolak dari Auto-Read
     */
    public function test_unhappy_path_invalid_store_marker_stays_pending(): void
    {
        Storage::fake('local');
        Queue::fake();
        config([
            'cctv.ingest_token' => str_repeat('a', 64),
            'cctv.auto_sync_packing' => true,
        ]);

        $camera = $this->camera();
        $this->post("/api/ingest/cameras/{$camera->id}/labels", [
            'field_one' => '061026-23',
            'field_three' => 'TOKO_PALSU_123',
            'confidence' => 0.99,
            'observed_at' => '2026-10-12T10:00:00Z',
            'snapshot' => $this->snapshot(),
        ], ['X-CCTV-Ingest-Token' => str_repeat('a', 64)])->assertCreated();

        $label = LabelRecord::first();
        $this->assertSame('needs_review', $label->review_status);
        $this->assertSame('TOKO_PALSU_123', $label->field_three);
        $this->assertNull($label->packing_completed_at);
        Queue::assertNothingPushed();
    }

    /**
     * UNHAPPY PATH 8: Idempotensi Fingerprint Mencegah Double Sync
     * Jika data tidak berubah dan sudah synced, job tidak boleh mengirim HTTP request ganda.
     */
    public function test_unhappy_path_idempotency_fingerprint_prevents_duplicate_http_request(): void
    {
        Storage::fake('local');
        Storage::disk('local')->put('cctv/labels/label-1.jpg', 'image-content');
        config([
            'cctv.slm_base_url' => 'https://mkr.lrmslm.com',
            'cctv.slm_sync_path' => '/api/cctv/labels/sync',
            'cctv.slm_token' => 'test-token',
            'app.url' => 'http://cctv.test',
            'cctv.slm_sync_upload_photo' => false,
        ]);

        Http::fake(['mkr.lrmslm.com/*' => Http::response(['saved' => true], 200)]);

        $camera = $this->camera();
        $label = LabelRecord::create([
            'camera_id' => $camera->id,
            'field_one' => '061026-23',
            'field_two' => 'TK HANSEL ASK',
            'field_three' => 'Aneka Jaya',
            'confidence' => 1.0,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
            'evidence_path' => 'cctv/labels/label-1.jpg',
            'review_status' => 'auto_read',
            'slm_status' => 'matched',
            'slm_reference' => 'S-1',
            'packing_completed_at' => now(),
        ]);

        // Run pertama: sukses dan tersimpan hash
        (new SyncMatchedLabelToSlm($label->id))->handle();
        $this->assertSame('synced', $label->fresh()->slm_sync_status);
        Http::assertSentCount(1);

        // Run kedua: data persis sama, harus langsung return tanpa memanggil HTTP lagi
        (new SyncMatchedLabelToSlm($label->id))->handle();
        Http::assertSentCount(1); // Tetap 1, tidak bertambah!
    }

    /**
     * UNHAPPY PATH 9: Re-scan dengan Confidence Lebih Rendah TIDAK Boleh Mengganti Snapshot / Downgrade Confidence
     */
    public function test_unhappy_path_rescan_with_lower_confidence_does_not_downgrade_or_replace_snapshot(): void
    {
        Storage::fake('local');
        $ingestToken = str_repeat('a', 64);
        config(['cctv.ingest_token' => $ingestToken]);
        $camera = $this->camera();

        // 1. Scan pertama: high confidence (0.95), foto pertama
        $snap1 = UploadedFile::fake()->create('snap1.jpg', 150, 'image/jpeg');
        $this->post("/api/ingest/cameras/{$camera->id}/labels", [
            'field_one' => '121026-99',
            'field_two' => 'Toko Asli',
            'field_three' => 'Aneka Jaya',
            'confidence' => 0.95,
            'observed_at' => '2026-10-12T10:00:00Z',
            'snapshot' => $snap1,
        ], ['X-CCTV-Ingest-Token' => $ingestToken])->assertCreated();

        $label = LabelRecord::first();
        $this->assertSame(0.95, (float) $label->confidence);
        $this->assertSame('auto_verified', $label->review_status);
        $originalPath = $label->evidence_path;
        $this->assertTrue(Storage::disk('local')->exists($originalPath));

        // 2. Scan kedua (30 detik kemudian): buram/tangan lewat, confidence anjlok ke 0.35
        $snap2 = UploadedFile::fake()->create('snap2_blurry.jpg', 50, 'image/jpeg');
        $this->post("/api/ingest/cameras/{$camera->id}/labels", [
            'field_one' => '121026-99',
            'confidence' => 0.35,
            'observed_at' => '2026-10-12T10:00:30Z',
            'snapshot' => $snap2,
        ], ['X-CCTV-Ingest-Token' => $ingestToken])->assertOk();

        $fresh = $label->fresh();
        // Confidence TIDAK boleh turun
        $this->assertSame(0.95, (float) $fresh->confidence);
        // Status TIDAK boleh turun jadi pending
        $this->assertSame('auto_verified', $fresh->review_status);
        // File snapshot TIDAK boleh diganti dengan gambar buram
        $this->assertSame($originalPath, $fresh->evidence_path);
        $this->assertTrue(Storage::disk('local')->exists($originalPath));
    }

    /**
     * UNHAPPY PATH 10: Re-scan Saat Snapshot Lama Terhapus dari Disk (Graceful Storage Recovery)
     */
    public function test_unhappy_path_rescan_recovers_when_old_evidence_file_was_deleted_from_disk(): void
    {
        Storage::fake('local');
        $ingestToken = str_repeat('a', 64);
        config(['cctv.ingest_token' => $ingestToken]);
        $camera = $this->camera();

        // 1. Scan pertama
        $this->post("/api/ingest/cameras/{$camera->id}/labels", [
            'field_one' => '121026-77',
            'confidence' => 0.60,
            'observed_at' => '2026-10-12T10:00:00Z',
            'snapshot' => $this->snapshot(),
        ], ['X-CCTV-Ingest-Token' => $ingestToken])->assertCreated();

        $label = LabelRecord::first();
        $oldPath = $label->evidence_path;
        $this->assertTrue(Storage::disk('local')->exists($oldPath));

        // Hapus file dari disk secara manual (simulasi file hilang/korup)
        Storage::disk('local')->delete($oldPath);
        $this->assertFalse(Storage::disk('local')->exists($oldPath));

        // 2. Scan kedua datang
        $newSnap = UploadedFile::fake()->create('recovered.jpg', 120, 'image/jpeg');
        $res = $this->post("/api/ingest/cameras/{$camera->id}/labels", [
            'field_one' => '121026-77',
            'confidence' => 0.60,
            'observed_at' => '2026-10-12T10:01:00Z',
            'snapshot' => $newSnap,
        ], ['X-CCTV-Ingest-Token' => $ingestToken]);

        $res->assertOk();
        $fresh = $label->fresh();
        // File baru berhasil disimpan dan menutupi file yang hilang
        $this->assertNotEmpty($fresh->evidence_path);
        $this->assertTrue(Storage::disk('local')->exists($fresh->evidence_path));
    }

    /**
     * UNHAPPY PATH 11: Re-scan dengan Toko Palsu/Tidak Valid Ditolak dari Auto-Read
     */
    public function test_unhappy_path_rescan_with_invalid_store_does_not_auto_read_or_auto_pack(): void
    {
        Storage::fake('local');
        Queue::fake();
        $ingestToken = str_repeat('a', 64);
        config([
            'cctv.ingest_token' => $ingestToken,
            'cctv.auto_sync_packing' => true,
        ]);
        $camera = $this->camera();

        // 1. Scan pertama: low confidence (0.50), pending
        $this->post("/api/ingest/cameras/{$camera->id}/labels", [
            'field_one' => '121026-55',
            'confidence' => 0.50,
            'observed_at' => '2026-10-12T10:00:00Z',
            'snapshot' => $this->snapshot(),
        ], ['X-CCTV-Ingest-Token' => $ingestToken])->assertCreated();

        $label = LabelRecord::first();
        $this->assertSame('needs_review', $label->review_status);

        // 2. Scan kedua: confidence tinggi (0.95), tetapi toko tidak valid
        $this->post("/api/ingest/cameras/{$camera->id}/labels", [
            'field_one' => '121026-55',
            'field_two' => 'Toko Barokah',
            'field_three' => 'TOKO_PALSU_XYZ',
            'confidence' => 0.95,
            'observed_at' => '2026-10-12T10:01:00Z',
            'snapshot' => $this->snapshot(),
        ], ['X-CCTV-Ingest-Token' => $ingestToken])->assertOk();

        $fresh = $label->fresh();
        $this->assertSame(0.95, (float) $fresh->confidence);
        $this->assertSame('needs_review', $fresh->review_status, 'Toko palsu tidak boleh di-upgrade ke auto_verified');
        $this->assertNull($fresh->packing_completed_at);
        Queue::assertNothingPushed();
    }

    /**
     * UNHAPPY PATH 12: Sync Matched Label Saat Base URL / Token Belum Dikonfigurasi
     */
    public function test_unhappy_path_sync_fails_cleanly_when_configuration_is_invalid(): void
    {
        Storage::fake('local');
        Storage::disk('local')->put('cctv/labels/test.jpg', 'binary-data');

        config([
            'cctv.slm_base_url' => '', // Kosong
            'cctv.slm_sync_path' => '/api/cctv/labels/sync',
            'cctv.slm_token' => '',
            'app.url' => 'https://cctv.lrmslm.com',
        ]);

        $camera = $this->camera();
        $label = LabelRecord::create([
            'camera_id' => $camera->id,
            'field_one' => '121026-44',
            'confidence' => 1.0,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
            'evidence_path' => 'cctv/labels/test.jpg',
            'review_status' => 'confirmed',
            'slm_status' => 'matched',
            'slm_reference' => 'S-44',
        ]);

        (new SyncMatchedLabelToSlm($label->id))->handle();

        $fresh = $label->fresh();
        $this->assertSame('pending_configuration', $fresh->slm_sync_status);
        Http::assertNothingSent();
    }
}

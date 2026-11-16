<?php

namespace Tests\Feature;

use App\Jobs\SyncMatchedLabelToSlm;
use App\Models\Camera;
use App\Models\Incident;
use App\Models\LabelRecord;
use App\Models\PresenceTrack;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class UnhappyPathVerificationTest extends TestCase
{
    use RefreshDatabase;

    private function camera(): Camera
    {
        return Camera::create([
            'name' => 'Camera Meja 14',
            'location' => 'Meja Packing',
            'stream_env_key' => 'CCTV_CAMERA_14_URL',
            'status' => 'online',
            'last_seen_at' => now(),
            'zones_approved_at' => now(),
        ]);
    }

    private function dummyImage(): UploadedFile
    {
        return UploadedFile::fake()->image('test_label.jpg', 640, 480);
    }

    // =========================================================================
    // 1. STORAGE PRUNING UNHAPPY PATHS & ADVERSARIAL CASES
    // =========================================================================

    /**
     * Unhappy Path: Reference file pada database hilang dari disk (Ghost File).
     * Command tidak boleh crash/throw FileNotFoundException, dan harus membersihkan referensi di DB.
     */
    public function test_prune_storage_handles_missing_file_on_disk_gracefully_without_throwing(): void
    {
        Storage::fake('local');
        $camera = $this->camera();
        $oldDate = Carbon::now()->subDays(75);

        $ghostPath = 'cctv/evidence/ghost_missing_file.jpg';
        // Sengaja TIDAK membuat file di Storage::disk('local')

        $label = LabelRecord::create([
            'camera_id' => $camera->id,
            'field_one' => '161026-01',
            'first_seen_at' => $oldDate,
            'last_seen_at' => $oldDate,
            'created_at' => $oldDate,
            'packing_completed_at' => $oldDate,
            'evidence_path' => $ghostPath,
            'review_status' => 'auto_verified',
            'slm_status' => 'matched',
            'slm_sync_status' => 'synced',
        ]);

        $exitCode = Artisan::call('cctv:prune-storage', ['--days' => 60]);
        $this->assertSame(0, $exitCode);

        // Path harus di-null tanpa error
        $this->assertNull($label->fresh()->evidence_path);
    }

    /**
     * Unhappy Path: Label yang sync-nya GAGAL/ERROR atau PENDING CONFIGURATION tidak boleh dihapus,
     * berapapun usianya (misal sudah 180 hari).
     */
    public function test_prune_storage_never_deletes_unsynced_labels_even_in_error_or_stale_state(): void
    {
        Storage::fake('local');
        $camera = $this->camera();
        $ancientDate = Carbon::now()->subDays(180);

        $statuses = ['error', 'not_ready', 'pending_configuration', 'queued'];
        $createdLabels = [];

        foreach ($statuses as $idx => $status) {
            $path = "cctv/evidence/stale_{$status}.jpg";
            Storage::disk('local')->put($path, "binary-{$status}");

            $createdLabels[] = LabelRecord::create([
                'camera_id' => $camera->id,
                'field_one' => "161026-{$idx}",
                'first_seen_at' => $ancientDate,
                'last_seen_at' => $ancientDate,
                'created_at' => $ancientDate,
                'packing_completed_at' => $ancientDate,
                'evidence_path' => $path,
                'review_status' => 'auto_verified',
                'slm_status' => 'matched',
                'slm_sync_status' => $status,
            ]);
        }

        Artisan::call('cctv:prune-storage', ['--days' => 30]);

        foreach ($createdLabels as $label) {
            $this->assertTrue(Storage::disk('local')->exists($label->evidence_path), "File untuk status {$label->slm_sync_status} tidak boleh dihapus");
            $this->assertNotNull($label->fresh()->evidence_path);
        }
    }

    /**
     * Unhappy Path: Parameter --days bernilai negatif atau nol tidak boleh menghapus file hari ini/kemarin.
     */
    public function test_prune_storage_rejects_negative_or_zero_days_and_defaults_to_safe_minimum(): void
    {
        Storage::fake('local');
        $camera = $this->camera();
        $recentDate = Carbon::now()->subHours(2); // Dibuat 2 jam lalu

        $recentPath = 'cctv/evidence/recent_pack.jpg';
        Storage::disk('local')->put($recentPath, 'recent-data');

        $label = LabelRecord::create([
            'camera_id' => $camera->id,
            'field_one' => '161026-99',
            'first_seen_at' => $recentDate,
            'last_seen_at' => $recentDate,
            'created_at' => $recentDate,
            'packing_completed_at' => $recentDate,
            'evidence_path' => $recentPath,
            'review_status' => 'auto_verified',
            'slm_status' => 'matched',
            'slm_sync_status' => 'synced',
        ]);

        // Uji dengan parameter negatif
        Artisan::call('cctv:prune-storage', ['--days' => -10]);

        // File hari ini TIDAK boleh terhapus
        $this->assertTrue(Storage::disk('local')->exists($recentPath));
        $this->assertSame($recentPath, $label->fresh()->evidence_path);
    }

    /**
     * Unhappy Path: Berkas insiden parsial (hanya ada clip tanpa snapshot, atau snapshot tanpa clip).
     */
    public function test_prune_storage_incident_partial_files_cleaned_up_without_error(): void
    {
        Storage::fake('local');
        $camera = $this->camera();
        $oldDate = Carbon::now()->subDays(120);

        $clipOnly = 'cctv/incidents/clip_only.mp4';
        Storage::disk('local')->put($clipOnly, 'clip-binary');

        $incident = Incident::create([
            'camera_id' => $camera->id,
            'type' => 'anomaly',
            'status' => 'confirmed',
            'reason' => 'Anomali masa lalu',
            'occurred_at' => $oldDate,
            'resolved_at' => $oldDate,
            'snapshot_path' => null, // Tidak ada snapshot
            'clip_path' => $clipOnly,
            'dedupe_key' => 'dedupe_partial_clip_1',
        ]);

        Artisan::call('cctv:prune-storage', ['--incident-days' => 90]);

        $this->assertFalse(Storage::disk('local')->exists($clipOnly));
        $this->assertNull($incident->fresh()->clip_path);
    }

    // =========================================================================
    // 2. DISK SPACE HEALTH CHECK UNHAPPY PATHS & SAFETY
    // =========================================================================

    /**
     * Unhappy Path: Peringatan kapasitas disk tidak boleh membanjiri database jika check-health dijalankan berulang.
     */
    public function test_health_check_deduplication_prevents_spamming_multiple_disk_warning_incidents(): void
    {
        $camera = $this->camera();

        // Paksa ambang batas terpicu
        Config::set('cctv.min_free_disk_percent', 100.0);
        Config::set('cctv.min_free_disk_gb', 999999.0);

        // Jalankan berkali-kali
        for ($i = 0; $i < 5; $i++) {
            Artisan::call('cctv:check-health');
        }

        // Tepat 1 record insiden disk_space_warning yang boleh dibuat untuk jam tersebut
        $count = Incident::where('type', 'disk_space_warning')->count();
        $this->assertSame(1, $count, 'Deduplikasi harus mencegah spam insiden peringatan disk');
    }

    /**
     * Unhappy Path: Database baru tanpa satupun kamera terdaftar tidak boleh melempar Foreign Key exception.
     */
    public function test_health_check_without_any_registered_camera_does_not_throw_foreign_key_exception(): void
    {
        // Pastikan tidak ada kamera
        $this->assertSame(0, Camera::count());

        Config::set('cctv.min_free_disk_percent', 100.0);
        Config::set('cctv.min_free_disk_gb', 999999.0);

        // Jalankan command - tidak boleh meledak dengan PDOException
        $exitCode = Artisan::call('cctv:check-health');
        $this->assertSame(0, $exitCode);
    }

    // =========================================================================
    // 3. VERIFICATION GATEKEEPER & OCR ADVERSARIAL CASES
    // =========================================================================

    /**
     * Unhappy Path: Nomor invoice cacat atau karakter berbahaya DIBLOKIR dari auto_verified
     * meskipun skor confidence sempurna (1.0 / 100%).
     */
    public function test_unhappy_path_malformed_invoice_numbers_blocked_from_auto_verified(): void
    {
        Storage::fake('local');
        Queue::fake();
        $camera = $this->camera();
        $token = config('cctv.ingest_token');

        $malformedCodes = [
            '12345',               // Terlalu pendek
            'ABCDEF-01',           // Huruf bukan angka
            '161026-999',          // 3 digit di belakang
            '161026_01',           // Underscore bukan hyphen
            "161026-07' OR '1'='1", // SQL Injection attempt
        ];

        foreach ($malformedCodes as $code) {
            $response = $this->post("/api/ingest/cameras/{$camera->id}/labels", [
                'field_one' => $code,
                'field_two' => 'Nama Toko Valid',
                'field_three' => 'Aneka Jaya',
                'confidence' => 1.0, // Skor confidence 100%!
                'observed_at' => now()->toIso8601String(),
                'snapshot' => $this->dummyImage(),
            ], ['X-CCTV-Ingest-Token' => $token, 'Accept' => 'application/json']);

            $response->assertSuccessful();

            $label = LabelRecord::where('field_one', $code)->first();
            $this->assertNotNull($label, "Label dengan kode '{$code}' harus tercatat");
            $this->assertSame('needs_review', $label->review_status, "Kode cacat '{$code}' TIDAK BOLEH auto_verified");
            $this->assertNull($label->packing_completed_at);
        }

        // Tidak boleh ada job sinkronisasi yang masuk antrean
        Queue::assertNothingPushed();
    }

    /**
     * Unhappy Path: Confidence persis di bawah batas (0.8999 vs 0.90) harus ditolak dari auto_verified.
     */
    public function test_unhappy_path_boundary_confidence_just_below_threshold(): void
    {
        Storage::fake('local');
        Queue::fake();
        $camera = $this->camera();
        $token = config('cctv.ingest_token');

        $this->post("/api/ingest/cameras/{$camera->id}/labels", [
            'field_one' => '161026-07',
            'field_two' => 'Pembeli Valid',
            'field_three' => 'Aneka Jaya',
            'confidence' => 0.8999, // Persis di bawah 0.90
            'observed_at' => now()->toIso8601String(),
            'snapshot' => $this->dummyImage(),
        ], ['X-CCTV-Ingest-Token' => $token, 'Accept' => 'application/json'])->assertSuccessful();

        $label = LabelRecord::first();
        $this->assertSame('needs_review', $label->review_status);
        $this->assertNull($label->packing_completed_at);

        // Insiden needs_review otomatis dibuat untuk operator
        $this->assertDatabaseHas('incidents', [
            'camera_id' => $camera->id,
            'type' => 'label_needs_review',
            'status' => 'needs_review',
        ]);

        Queue::assertNothingPushed();
    }

    /**
     * Unhappy Path: Penolakan oleh operator (status = rejected)
     * Insiden ditutup (dismissed) dan ERP sinkronisasi DILARANG dikirim.
     */
    public function test_unhappy_path_operator_rejection_marks_incident_dismissed_and_blocks_erp(): void
    {
        Storage::fake('local');
        Queue::fake();
        $camera = $this->camera();
        $token = config('cctv.ingest_token');

        // 1. Ingest label buram
        $this->post("/api/ingest/cameras/{$camera->id}/labels", [
            'field_one' => '161026-08',
            'confidence' => 0.65,
            'observed_at' => now()->toIso8601String(),
            'snapshot' => $this->dummyImage(),
        ], ['X-CCTV-Ingest-Token' => $token, 'Accept' => 'application/json'])->assertSuccessful();

        $label = LabelRecord::first();
        $user = \App\Models\User::factory()->create(['is_admin' => true]);

        // 2. Operator menolak label ini
        $apiToken = str_repeat('b', 64);
        \Illuminate\Support\Facades\DB::table('api_tokens')->insert([
            'user_id' => $user->id,
            'name' => 'Operator Token',
            'token_hash' => hash('sha256', $apiToken),
            'expires_at' => now()->addDays(30),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->postJson("/api/labels/{$label->id}/review", [
            'status' => 'rejected',
            'note' => 'Bukan paket Playgo / barcode rusak tidak terbaca.',
        ], ['Authorization' => "Bearer {$apiToken}"])->assertSuccessful();

        $fresh = $label->fresh();
        $this->assertSame('rejected', $fresh->review_status);
        $this->assertNull($fresh->packing_completed_at);

        // Insiden ditutup dengan status dismissed
        $this->assertDatabaseHas('incidents', [
            'type' => 'label_needs_review',
            'status' => 'dismissed',
        ]);

        Queue::assertNothingPushed();
    }

    /**
     * Unhappy Path: Smart Rescan dengan frame berikutnya yang SAMA-SAMA BURAM tidak boleh meng-upgrade status.
     */
    public function test_unhappy_path_smart_rescan_with_subsequent_low_confidence_does_not_upgrade(): void
    {
        Storage::fake('local');
        Queue::fake();
        $camera = $this->camera();
        $token = config('cctv.ingest_token');

        // Scan 1: Confidence 0.60
        $this->post("/api/ingest/cameras/{$camera->id}/labels", [
            'field_one' => '161026-11',
            'confidence' => 0.60,
            'observed_at' => now()->toIso8601String(),
            'snapshot' => $this->dummyImage(),
        ], ['X-CCTV-Ingest-Token' => $token, 'Accept' => 'application/json'])->assertSuccessful();

        // Scan 2: Confidence 0.75 (sedikit lebih baik, tapi masih < 0.90)
        $this->post("/api/ingest/cameras/{$camera->id}/labels", [
            'field_one' => '161026-11',
            'confidence' => 0.75,
            'observed_at' => now()->addSeconds(1)->toIso8601String(),
            'snapshot' => $this->dummyImage(),
        ], ['X-CCTV-Ingest-Token' => $token, 'Accept' => 'application/json'])->assertSuccessful();

        $label = LabelRecord::first();
        $this->assertSame('needs_review', $label->review_status, 'Harus tetap needs_review karena masih di bawah 0.90');
        $this->assertEquals(0.75, (float) $label->confidence);

        $incident = Incident::where('type', 'label_needs_review')->first();
        $this->assertSame('needs_review', $incident->status, 'Insiden tidak boleh di-confirm otomatis jika frame kedua masih buram');

        Queue::assertNothingPushed();
    }

    /**
     * Unhappy Path: Dwell time tidak cukup (0 detik) tidak memicu auto-packing selesai.
     */
    public function test_unhappy_path_zero_dwell_time_does_not_auto_complete_packing(): void
    {
        Storage::fake('local');
        Queue::fake();
        $camera = $this->camera();
        $token = config('cctv.ingest_token');

        // Aktifkan min_dwell_seconds = 3 detik
        Config::set('cctv.min_dwell_seconds', 3);
        Config::set('cctv.auto_sync_packing', true);

        // Kirim deteksi dengan dwell_seconds = 0
        $this->post("/api/ingest/cameras/{$camera->id}/labels", [
            'field_one' => '161026-22',
            'field_two' => 'Customer Cepat',
            'field_three' => 'Aneka Jaya',
            'confidence' => 0.99,
            'observed_at' => now()->toIso8601String(),
            'dwell_seconds' => 0,
            'snapshot' => $this->dummyImage(),
        ], ['X-CCTV-Ingest-Token' => $token, 'Accept' => 'application/json'])->assertSuccessful();

        $label = LabelRecord::first();
        $label = $this->runMatchJob($label);
        $this->assertNull($label->packing_completed_at, 'Paket dengan dwell_time 0 detik tidak boleh dianggap selesai packing');
        Queue::assertNotPushed(\App\Jobs\SyncMatchedLabelToSlm::class);
    }

    // =========================================================================
    // 4. TIMESTAMP LOCKING UNDER WORKER LATENCY & NETWORK OUTAGE
    // =========================================================================

    /**
     * Unhappy Path: Worker sinkronisasi tertunda selama 30 HARI.
     * Payload occurred_at dan packing_completed_at yang dikirim ke ERP SLM TIDAK BOLEH bocor ke waktu worker saat ini.
     */
    public function test_unhappy_path_worker_delayed_execution_does_not_leak_current_time(): void
    {
        Storage::fake('local');
        $camera = $this->camera();

        $physicalTime = Carbon::parse('2026-10-14T04:21:30+00:00');
        $photoPath = 'cctv/evidence/label_oct14.jpg';
        Storage::disk('local')->put($photoPath, 'binary-image');

        $label = new LabelRecord([
            'camera_id' => $camera->id,
            'field_one' => '141026-01',
            'field_two' => 'Paket Tertunda',
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
        $label->save();

        Config::set('cctv.slm_base_url', 'https://slm.playgo.id');
        Config::set('cctv.slm_sync_path', '/api/cctv/labels/sync');
        Config::set('cctv.slm_token', 'token-slm-valid');

        // Simulasikan worker baru berjalan 30 HARI KEMUDIAN (14 November 2026)
        Carbon::setTestNow(Carbon::parse('2026-11-14T10:00:00+00:00'));

        $recordedPayload = null;
        Http::fake([
            'https://slm.playgo.id/api/cctv/labels/sync' => function ($request) use (&$recordedPayload) {
                $recordedPayload = $request->data();
                return Http::response(['saved' => true], 200);
            },
        ]);

        $job = new SyncMatchedLabelToSlm($label->id);
        $job->handle();

        $this->assertNotNull($recordedPayload);

        // Validasi payload TIDAK BOLEH menggunakan waktu November
        $this->assertSame('2026-10-14T04:21:30+00:00', $recordedPayload['occurred_at']);
        $this->assertNotSame('2026-11-14T10:00:00+00:00', $recordedPayload['occurred_at']);
        $this->assertSame('2026-10-14T04:21:30+00:00', $recordedPayload['data']['packing_completed_at']);
        $this->assertSame('2026-10-14T04:21:30+00:00', $recordedPayload['data']['detected_at']);

        Carbon::setTestNow();
    }

    /**
     * Unhappy Path: Server ERP SLM merespons 500 saat worker berjalan.
     * Label record tetap mempertahankan tanggal fisik asli dan tidak ter-reset ke now().
     */
    public function test_unhappy_path_erp_sync_fails_with_network_error_preserves_original_timestamp(): void
    {
        Storage::fake('local');
        $camera = $this->camera();

        $physicalTime = Carbon::parse('2026-10-14T08:00:00+00:00');
        $photoPath = 'cctv/evidence/label_error.jpg';
        Storage::disk('local')->put($photoPath, 'binary');

        $label = new LabelRecord([
            'camera_id' => $camera->id,
            'field_one' => '141026-02',
            'confidence' => 0.95,
            'first_seen_at' => $physicalTime,
            'last_seen_at' => $physicalTime,
            'created_at' => $physicalTime,
            'evidence_path' => $photoPath,
            'review_status' => 'auto_verified',
            'slm_status' => 'matched',
            'slm_sync_status' => 'queued',
            'packing_completed_at' => $physicalTime,
        ]);
        $label->save();

        Config::set('cctv.slm_base_url', 'https://slm.playgo.id');
        Config::set('cctv.slm_sync_path', '/api/cctv/labels/sync');
        Config::set('cctv.slm_token', 'token-slm');

        // ERP mengalami outage HTTP 500
        Http::fake([
            'https://slm.playgo.id/api/cctv/labels/sync' => Http::response(['message' => 'Internal Server Error'], 500),
        ]);

        $job = new SyncMatchedLabelToSlm($label->id);
        try {
            $job->handle();
        } catch (\Throwable $e) {
            $job->failed($e);
        }

        $fresh = $label->fresh();
        // Status sinkronisasi error
        $this->assertSame('error', $fresh->slm_sync_status);
        // Tanggal fisik deteksi TIDAK BOLEH terkorupsi atau berubah
        $this->assertTrue($fresh->first_seen_at->equalTo($physicalTime));
        $this->assertTrue($fresh->packing_completed_at->equalTo($physicalTime));
    }
}

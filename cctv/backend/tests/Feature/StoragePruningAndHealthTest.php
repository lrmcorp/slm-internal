<?php

namespace Tests\Feature;

use App\Models\Camera;
use App\Models\Incident;
use App\Models\LabelRecord;
use App\Models\PresenceTrack;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class StoragePruningAndHealthTest extends TestCase
{
    use RefreshDatabase;

    private function camera(): Camera
    {
        return Camera::create([
            'name' => 'Camera 14',
            'location' => 'Meja Packing',
            'stream_env_key' => 'CCTV_CAMERA_14_URL',
            'status' => 'online',
            'last_seen_at' => now(),
        ]);
    }

    /**
     * Requirement 1: Pembersihan foto bukti label yang sudah berumur > 60 hari dan sudah SYNCED
     */
    public function test_prune_storage_deletes_old_synced_evidence_and_sets_evidence_path_null(): void
    {
        Storage::fake('local');
        $camera = $this->camera();

        $oldDate = Carbon::now()->subDays(70);
        $filePath = 'cctv/evidence/label_old_synced.jpg';
        Storage::disk('local')->put($filePath, 'image-data-old-synced');

        $label = LabelRecord::create([
            'camera_id' => $camera->id,
            'field_one' => '100826-01',
            'field_two' => 'Budi Toko',
            'field_three' => 'Aneka Jaya',
            'confidence' => 0.98,
            'first_seen_at' => $oldDate,
            'last_seen_at' => $oldDate,
            'created_at' => $oldDate,
            'packing_completed_at' => $oldDate,
            'evidence_path' => $filePath,
            'review_status' => 'auto_verified',
            'slm_status' => 'matched',
            'slm_sync_status' => 'synced',
        ]);

        $this->assertTrue(Storage::disk('local')->exists($filePath));

        $exitCode = Artisan::call('cctv:prune-storage', ['--days' => 60]);
        $this->assertSame(0, $exitCode);

        // Berkas fisik foto di disk harus terhapus
        $this->assertFalse(Storage::disk('local')->exists($filePath));

        // Catatan database harus tetap ada, hanya evidence_path yang di-set null
        $fresh = $label->fresh();
        $this->assertNotNull($fresh);
        $this->assertSame('100826-01', $fresh->field_one);
        $this->assertNull($fresh->evidence_path);
    }

    /**
     * Requirement 2: Safety Guardrails - Label yang BELUM synced atau masih butuh review TIDAK BOLEH dihapus
     */
    public function test_prune_storage_preserves_unsynced_and_needs_review_labels(): void
    {
        Storage::fake('local');
        $camera = $this->camera();

        $oldDate = Carbon::now()->subDays(70);

        // Kasus A: Sudah lama (70 hari) tetapi BELUM synced (not_ready / error)
        $pathUnsynced = 'cctv/evidence/label_unsynced.jpg';
        Storage::disk('local')->put($pathUnsynced, 'image-unsynced');
        $labelUnsynced = LabelRecord::create([
            'camera_id' => $camera->id,
            'field_one' => '100826-02',
            'confidence' => 0.95,
            'first_seen_at' => $oldDate,
            'last_seen_at' => $oldDate,
            'created_at' => $oldDate,
            'packing_completed_at' => $oldDate,
            'evidence_path' => $pathUnsynced,
            'review_status' => 'auto_verified',
            'slm_status' => 'matched',
            'slm_sync_status' => 'not_ready', // Guardrail aktif!
        ]);

        // Kasus B: Sudah lama (70 hari) tetapi masih butuh peninjauan operator (needs_review)
        $pathNeedsReview = 'cctv/evidence/label_needs_review.jpg';
        Storage::disk('local')->put($pathNeedsReview, 'image-needs-review');
        $labelNeedsReview = LabelRecord::create([
            'camera_id' => $camera->id,
            'field_one' => '100826-03',
            'confidence' => 0.70,
            'first_seen_at' => $oldDate,
            'last_seen_at' => $oldDate,
            'created_at' => $oldDate,
            'evidence_path' => $pathNeedsReview,
            'review_status' => 'needs_review', // Guardrail aktif!
            'slm_status' => 'unavailable',
            'slm_sync_status' => 'synced',
        ]);

        Artisan::call('cctv:prune-storage', ['--days' => 60]);

        // Kedua berkas foto fisik HARUS tetap ada di disk
        $this->assertTrue(Storage::disk('local')->exists($pathUnsynced));
        $this->assertTrue(Storage::disk('local')->exists($pathNeedsReview));

        // Path di database tidak boleh di-null
        $this->assertSame($pathUnsynced, $labelUnsynced->fresh()->evidence_path);
        $this->assertSame($pathNeedsReview, $labelNeedsReview->fresh()->evidence_path);
    }

    /**
     * Requirement 3: Pembersihan insiden yang sudah resolved dan berumur > 90 hari
     */
    public function test_prune_storage_prunes_resolved_incidents_and_preserves_unresolved(): void
    {
        Storage::fake('local');
        $camera = $this->camera();
        $oldDate = Carbon::now()->subDays(100);

        // Insiden A: Sudah disetujui/resolved > 90 hari lalu
        $snapA = 'cctv/incidents/snap_resolved.jpg';
        $clipA = 'cctv/incidents/clip_resolved.mp4';
        Storage::disk('local')->put($snapA, 'snap-data');
        Storage::disk('local')->put($clipA, 'clip-data');
        $incidentResolved = Incident::create([
            'camera_id' => $camera->id,
            'type' => 'anomaly',
            'status' => 'confirmed',
            'reason' => 'Anomali barang lama',
            'occurred_at' => $oldDate,
            'resolved_at' => $oldDate,
            'snapshot_path' => $snapA,
            'clip_path' => $clipA,
            'dedupe_key' => 'dedupe_resolved_1',
        ]);

        // Insiden B: Belum selesai (needs_review / resolved_at null)
        $snapB = 'cctv/incidents/snap_unresolved.jpg';
        Storage::disk('local')->put($snapB, 'snap-unresolved');
        $incidentUnresolved = Incident::create([
            'camera_id' => $camera->id,
            'type' => 'anomaly',
            'status' => 'needs_review',
            'reason' => 'Anomali belum ditinjau',
            'occurred_at' => $oldDate,
            'resolved_at' => null,
            'snapshot_path' => $snapB,
            'dedupe_key' => 'dedupe_unresolved_2',
        ]);

        Artisan::call('cctv:prune-storage', ['--incident-days' => 90]);

        // Insiden A: Berkas fisik terhapus, path di database di-null
        $this->assertFalse(Storage::disk('local')->exists($snapA));
        $this->assertFalse(Storage::disk('local')->exists($clipA));
        $this->assertNull($incidentResolved->fresh()->snapshot_path);
        $this->assertNull($incidentResolved->fresh()->clip_path);

        // Insiden B: Berkas fisik dan database TETAP utuh karena belum ditinjau
        $this->assertTrue(Storage::disk('local')->exists($snapB));
        $this->assertSame($snapB, $incidentUnresolved->fresh()->snapshot_path);
    }

    /**
     * Requirement 4: Pembersihan jejak deteksi kehadiran orang anonim > 14 hari
     */
    public function test_prune_storage_prunes_old_presence_tracks(): void
    {
        Storage::fake('local');
        $camera = $this->camera();
        $oldDate = Carbon::now()->subDays(20);

        $snapTrack = 'cctv/presence/old_track.jpg';
        Storage::disk('local')->put($snapTrack, 'presence-snapshot-data');

        $track = PresenceTrack::create([
            'camera_id' => $camera->id,
            'session_id' => 'session-123',
            'track_id' => 'track-456',
            'classification' => 'unclassified',
            'first_seen_at' => $oldDate,
            'last_seen_at' => $oldDate,
            'snapshot_path' => $snapTrack,
        ]);

        Artisan::call('cctv:prune-storage', ['--presence-days' => 14]);

        $this->assertFalse(Storage::disk('local')->exists($snapTrack));
        $this->assertDatabaseMissing('presence_tracks', ['id' => $track->id]);
    }

    /**
     * Requirement 5: Mode Dry-Run tidak menghapus berkas dan tidak memodifikasi database
     */
    public function test_prune_storage_dry_run_does_not_delete_anything(): void
    {
        Storage::fake('local');
        $camera = $this->camera();
        $oldDate = Carbon::now()->subDays(70);

        $filePath = 'cctv/evidence/dry_run_test.jpg';
        Storage::disk('local')->put($filePath, 'dry-run-data');

        $label = LabelRecord::create([
            'camera_id' => $camera->id,
            'field_one' => '100826-99',
            'confidence' => 0.99,
            'first_seen_at' => $oldDate,
            'last_seen_at' => $oldDate,
            'created_at' => $oldDate,
            'packing_completed_at' => $oldDate,
            'evidence_path' => $filePath,
            'review_status' => 'auto_verified',
            'slm_status' => 'matched',
            'slm_sync_status' => 'synced',
        ]);

        Artisan::call('cctv:prune-storage', ['--days' => 60, '--dry-run' => true]);

        // File dan database tidak boleh berubah
        $this->assertTrue(Storage::disk('local')->exists($filePath));
        $this->assertSame($filePath, $label->fresh()->evidence_path);
    }

    /**
     * Requirement 6: Health Check Kapasitas Disk Memicu Insiden saat disk < batas aman
     */
    public function test_disk_space_warning_triggers_incident_when_threshold_breached(): void
    {
        $camera = $this->camera();

        // Atur batas min_free_disk_percent sangat tinggi (100%) agar simulasi mendeteksi disk kritis
        Config::set('cctv.min_free_disk_percent', 100.0);
        Config::set('cctv.min_free_disk_gb', 999999.0);

        Artisan::call('cctv:check-health');

        $incident = Incident::where('type', 'disk_space_warning')->first();
        $this->assertNotNull($incident, 'Insiden disk_space_warning harus dibuat saat kuota disk menipis');
        $this->assertSame('needs_review', $incident->status);
        $this->assertStringContainsString('Kapasitas disk kritis', $incident->reason);
        $this->assertNotNull($incident->metadata);
        $this->assertArrayHasKey('free_gb', $incident->metadata);
    }
}

<?php

namespace Tests\Feature;

use App\Models\Camera;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

class FullFrameAutoZoneTest extends TestCase
{
    use RefreshDatabase;

    public function test_newly_created_camera_automatically_gets_full_frame_auto_zone(): void
    {
        config(['cctv.auto_full_frame_zones' => true]);

        $camera = Camera::create([
            'name' => 'Kamera Packing Baru',
            'stream_env_key' => 'CCTV_CAMERA_99_URL',
        ]);

        $this->assertEquals('active', $camera->status);
        $this->assertNotNull($camera->zones_approved_at);
        $this->assertIsArray($camera->zones);
        $this->assertCount(3, $camera->zones);

        $types = array_column($camera->zones, 'type');
        $this->assertContains('store_boundary', $types);
        $this->assertContains('packing_route', $types);
        $this->assertContains('box_area', $types);

        // Pastikan koordinat mencakup 0,0 sampai 1,1
        $storeBoundary = collect($camera->zones)->firstWhere('type', 'store_boundary');
        $this->assertEquals([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]], $storeBoundary['points']);
    }

    public function test_artisan_command_applies_full_frame_zones_to_unconfigured_cameras(): void
    {
        // Matikan sementara boot hook untuk mensimulasikan kamera lama yang unconfigured
        $camera = new Camera();
        $camera->name = 'Kamera Lama';
        $camera->stream_env_key = 'CCTV_CAMERA_88_URL';
        $camera->status = 'unconfigured';
        $camera->zones = null;
        $camera->zones_approved_at = null;
        $camera->saveQuietly();

        $this->assertNull($camera->zones);
        $this->assertNull($camera->zones_approved_at);

        // Jalankan artisan command
        $exitCode = Artisan::call('cctv:apply-full-frame-zones');
        $this->assertEquals(0, $exitCode);

        $camera->refresh();
        $this->assertEquals('active', $camera->status);
        $this->assertNotNull($camera->zones_approved_at);
        $this->assertCount(3, $camera->zones);
    }

    public function test_ingest_heartbeat_returns_zones_approved_true_for_full_frame_camera(): void
    {
        config(['cctv.auto_full_frame_zones' => true]);

        $camera = Camera::create([
            'name' => 'Kamera Meja 1',
            'stream_env_key' => 'CCTV_CAMERA_1_URL',
        ]);

        $token = config('cctv.ingest_token');

        $response = $this->withHeader('X-CCTV-Ingest-Token', $token)
            ->postJson("/api/ingest/cameras/{$camera->id}/heartbeat", [
                'status' => 'online',
            ]);

        $response->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('zones_approved', true)
            ->assertJsonCount(3, 'zones');
    }

    public function test_admin_can_apply_full_frame_zones_via_web_button(): void
    {
        $admin = User::create([
            'name' => 'Admin Gudang',
            'email' => 'admin@slm.com',
            'password' => 'password123456',
            'is_admin' => true,
        ]);

        $camera = new Camera();
        $camera->name = 'Kamera Custom';
        $camera->stream_env_key = 'CCTV_CAMERA_77_URL';
        $camera->status = 'unconfigured';
        $camera->zones = null;
        $camera->zones_approved_at = null;
        $camera->saveQuietly();

        $response = $this->actingAs($admin)
            ->post("/cameras/{$camera->id}/zones/apply-full-frame");

        $response->assertRedirect();

        $camera->refresh();
        $this->assertEquals('active', $camera->status);
        $this->assertNotNull($camera->zones_approved_at);
        $this->assertCount(3, $camera->zones);
    }
}

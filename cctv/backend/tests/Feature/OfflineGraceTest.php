<?php

namespace Tests\Feature;

use App\Models\Camera;
use App\Models\Incident;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class OfflineGraceTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_short_disconnect_during_restart_is_not_an_incident_but_a_long_one_is(): void
    {
        Queue::fake();
        config(['cctv.ingest_token' => str_repeat('c', 64), 'cctv.offline_grace_seconds' => 180]);
        $camera = Camera::create(['name' => 'Camera 12', 'location' => 'Toko', 'stream_env_key' => 'CCTV_CAMERA_96_URL']);
        $heartbeat = fn (string $status) => $this->postJson("/api/ingest/cameras/{$camera->id}/heartbeat", ['status' => $status],
            ['X-CCTV-Ingest-Token' => str_repeat('c', 64)])->assertOk();

        Carbon::setTestNow('2026-11-26 06:00:00');
        $heartbeat('online');
        Carbon::setTestNow('2026-11-26 06:01:00');
        $heartbeat('offline');                       // pemroses video dinyalakan ulang
        Carbon::setTestNow('2026-11-26 06:02:00');
        $heartbeat('offline');
        $this->artisan('cctv:check-health')->assertSuccessful();
        Carbon::setTestNow('2026-11-26 06:02:30');
        $heartbeat('online');                        // tersambung lagi dalam 90 detik
        $this->artisan('cctv:check-health')->assertSuccessful();
        $this->assertSame(0, Incident::count());

        Carbon::setTestNow('2026-11-26 06:10:00');
        $heartbeat('offline');
        foreach (['06:11:00', '06:12:00', '06:13:30'] as $time) {
            Carbon::setTestNow("2026-11-26 {$time}");
            $heartbeat('offline');
            $this->artisan('cctv:check-health')->assertSuccessful();
        }
        $this->assertSame(['camera_offline'], Incident::pluck('type')->all());
        $this->assertStringContainsString('180 detik', Incident::first()->reason);
    }
}

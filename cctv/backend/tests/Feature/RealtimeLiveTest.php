<?php

namespace Tests\Feature;

use App\Models\Camera;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RealtimeLiveTest extends TestCase
{
    use RefreshDatabase;

    private function camera(): Camera
    {
        putenv('CCTV_CAMERA_94_URL=rtsp://dvr:p%40ss@100.118.114.23:8554/Streaming/Channels/1401');
        return Camera::create(['name' => 'Camera 14', 'stream_env_key' => 'CCTV_CAMERA_94_URL', 'location' => 'Meja packing']);
    }

    public function test_slm_token_gets_the_relay_substream_through_x_accel(): void
    {
        config(['cctv.realtime_relay' => true, 'cctv.slm_token' => 'tok-1']);
        $camera = $this->camera();
        $this->get("/cameras/{$camera->id}/realtime", ['X-SLM-Token' => 'tok-1'])
            ->assertOk()
            ->assertHeader('X-Accel-Redirect', '/_go2rtc/api/stream.mp4?src=ch1402');
    }

    public function test_main_stream_when_substream_is_disabled_and_dashboard_login_works(): void
    {
        config(['cctv.realtime_relay' => true, 'cctv.realtime_substream' => false]);
        $camera = $this->camera();
        $this->actingAs(User::factory()->create())->get("/cameras/{$camera->id}/realtime")
            ->assertHeader('X-Accel-Redirect', '/_go2rtc/api/stream.mp4?src=ch1401');
    }

    public function test_without_login_relay_or_hikvision_channel_there_is_no_stream(): void
    {
        config(['cctv.realtime_relay' => true, 'cctv.slm_token' => 'tok-1']);
        $camera = $this->camera();
        $response = $this->get("/cameras/{$camera->id}/realtime", ['X-SLM-Token' => 'salah']);
        $this->assertFalse($response->headers->has('X-Accel-Redirect'));

        config(['cctv.realtime_relay' => false]);
        $this->get("/cameras/{$camera->id}/realtime", ['X-SLM-Token' => 'tok-1'])->assertNotFound();

        config(['cctv.realtime_relay' => true]);
        putenv('CCTV_CAMERA_94_URL=/data/video.mp4');
        $this->get("/cameras/{$camera->id}/realtime", ['X-SLM-Token' => 'tok-1'])->assertNotFound();
    }
}

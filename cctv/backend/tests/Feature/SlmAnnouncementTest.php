<?php

namespace Tests\Feature;

use App\Jobs\SpeakAnnouncement;
use App\Models\Camera;
use App\Services\CameraSpeaker;
use App\Services\IsapiTalkSocket;
use App\Services\TextToSpeech;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class SlmAnnouncementTest extends TestCase
{
    use RefreshDatabase;

    private function camera(): Camera
    {
        putenv('CCTV_CAMERA_95_SPEAKER_URL=http://admin:x@100.118.114.23:8080');
        return Camera::create(['name' => 'Camera 14', 'stream_env_key' => 'CCTV_CAMERA_95_URL', 'location' => 'Meja packing']);
    }

    public function test_slm_announcement_is_queued_on_channel_13_by_default(): void
    {
        Queue::fake();
        Config::set('cctv.slm_token', 'tok-ann');
        $camera = $this->camera();
        Config::set('cctv.announce_camera_id', $camera->id);
        $text = 'Ada 2 pesanan yang belum diproses, atas nama Bu Ani dan Toko B. Mohon segera diproses.';

        $this->postJson('/api/v1/slm/announce', ['text' => $text], ['X-SLM-Token' => 'tok-ann'])
            ->assertStatus(202)->assertJson(['data' => ['camera_id' => $camera->id, 'channel' => 13]]);
        Queue::assertPushedOn('alerts', SpeakAnnouncement::class, fn ($job) => $job->text === $text && $job->channel === 13 && $job->cameraId === $camera->id);

        $this->postJson('/api/v1/slm/announce', ['text' => 'x', 'channel' => 5], ['X-SLM-Token' => 'tok-ann'])->assertStatus(202);
        Queue::assertPushed(SpeakAnnouncement::class, fn ($job) => $job->channel === 5);
    }

    public function test_announcement_needs_the_slm_token_and_a_speaker_address(): void
    {
        Queue::fake();
        Config::set('cctv.slm_token', 'tok-ann');
        $camera = $this->camera();
        Config::set('cctv.announce_camera_id', $camera->id);
        $this->postJson('/api/v1/slm/announce', ['text' => 'Tes'], ['X-SLM-Token' => 'salah'])->assertUnauthorized();
        putenv('CCTV_CAMERA_95_SPEAKER_URL');
        $this->postJson('/api/v1/slm/announce', ['text' => 'Tes'], ['X-SLM-Token' => 'tok-ann'])->assertStatus(422);
        Queue::assertNothingPushed();
    }

    public function test_job_plays_the_text_on_the_requested_channel_without_saving_it(): void
    {
        $camera = $this->camera();
        $tts = new class extends TextToSpeech {
            public array $texts = [];
            public function ulaw(string $text): string { $this->texts[] = $text; return str_repeat("\x7F", 800); }
        };
        $speaker = new class(new IsapiTalkSocket) extends CameraSpeaker {
            public array $channels = [];
            public function play(Camera $camera, string $ulaw): void { $this->channels[] = $camera->speaker_channel; }
        };
        (new SpeakAnnouncement($camera->id, 'Ada 1 pesanan yang belum diproses.', 13))->handle($tts, $speaker);
        $this->assertSame(['Ada 1 pesanan yang belum diproses.'], $tts->texts);
        $this->assertSame([13], $speaker->channels);
        $this->assertNotSame(13, (int) $camera->fresh()->speaker_channel);
    }
}

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
use Illuminate\Support\Facades\Http;
use App\Jobs\ReportAnnouncementToSlm;
use Tests\TestCase;

class SlmAnnouncementTest extends TestCase
{
    use RefreshDatabase;

    private function camera(): Camera
    {
        putenv('CCTV_CAMERA_95_SPEAKER_URL=http://admin:x@100.118.114.23:8080');
        return Camera::create(['name' => 'Camera 14', 'stream_env_key' => 'CCTV_CAMERA_95_URL', 'location' => 'Meja packing']);
    }

    public function test_slm_announcement_is_queued_on_channel_12_by_default(): void
    {
        Queue::fake();
        Config::set('cctv.slm_token', 'tok-ann');
        $camera = $this->camera();
        Config::set('cctv.announce_camera_id', $camera->id);
        $text = 'Ada 2 pesanan yang belum diproses, atas nama Bu Ani dan Toko B. Mohon segera diproses.';

        $this->postJson('/api/v1/slm/announce', ['text' => $text], ['X-SLM-Token' => 'tok-ann'])
            ->assertStatus(202)->assertJson(['data' => ['camera_id' => $camera->id, 'channel' => 12]]);
        Queue::assertPushedOn('alerts', SpeakAnnouncement::class, fn ($job) => $job->text === $text && $job->channels === [12] && $job->cameraId === $camera->id);

        $this->postJson('/api/v1/slm/announce', ['text' => 'x', 'channel' => 5], ['X-SLM-Token' => 'tok-ann'])->assertStatus(202);
        Queue::assertPushed(SpeakAnnouncement::class, fn ($job) => $job->channels === [5]);

        $this->postJson('/api/v1/slm/announce', ['text' => 'Promo hari ini', 'channels' => [13, 2, 13, 15]], ['X-SLM-Token' => 'tok-ann'])
            ->assertStatus(202)->assertJson(['data' => ['channels' => [13, 2, 15]]]);
        Queue::assertPushed(SpeakAnnouncement::class, fn ($job) => $job->channels === [13, 2, 15]);
        $this->postJson('/api/v1/slm/announce', ['text' => 'x', 'channels' => [99]], ['X-SLM-Token' => 'tok-ann'])->assertStatus(422);
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

    public function test_job_speaks_once_and_plays_on_each_channel_in_turn_even_if_one_fails(): void
    {
        $camera = $this->camera();
        $tts = new class extends TextToSpeech {
            public array $texts = [];
            public function ulaw(string $text): string { $this->texts[] = $text; return str_repeat("\x7F", 800); }
        };
        $speaker = new class(new IsapiTalkSocket) extends CameraSpeaker {
            public array $channels = [];
            public function play(Camera $camera, string $ulaw): void
            {
                $this->channels[] = $camera->speaker_channel;
                if ($camera->speaker_channel === 2) throw new \RuntimeException('kanal 2 sibuk');
            }
        };
        (new SpeakAnnouncement($camera->id, 'Ada 1 pesanan yang belum diproses.', [13, 2, 15]))->handle($tts, $speaker);
        $this->assertSame(['Ada 1 pesanan yang belum diproses.'], $tts->texts);
        $this->assertSame([13, 2, 15], $speaker->channels);
        $this->assertNotSame(13, (int) $camera->fresh()->speaker_channel);

        $this->expectExceptionMessage('gagal di semua kanal: 2');
        (new SpeakAnnouncement($camera->id, 'x', 2))->handle($tts, $speaker);
    }
    public function test_report_flag_is_passed_to_the_job_and_validated(): void
    {
        Queue::fake();
        Config::set('cctv.slm_token', 'tok-ann');
        $camera = $this->camera();
        Config::set('cctv.announce_camera_id', $camera->id);
        $this->postJson('/api/v1/slm/announce', ['text' => 'Ada 1 pesanan', 'channels' => [12, 15], 'report' => 'do-backlog'], ['X-SLM-Token' => 'tok-ann'])->assertStatus(202);
        Queue::assertPushed(SpeakAnnouncement::class, fn ($job) => $job->report === 'do-backlog' && $job->channels === [12, 15]);
        $this->postJson('/api/v1/slm/announce', ['text' => 'x', 'report' => 'Bukan Valid!'], ['X-SLM-Token' => 'tok-ann'])->assertStatus(422);
    }

    public function test_playback_result_is_reported_once_only_for_reported_announcements(): void
    {
        Queue::fake();
        $camera = $this->camera();
        $tts = new class extends TextToSpeech {
            public function ulaw(string $text): string { return str_repeat("\x7F", 800); }
        };
        $speaker = new class(new IsapiTalkSocket) extends CameraSpeaker {
            public function play(Camera $camera, string $ulaw): void
            {
                if ($camera->speaker_channel === 15) throw new \RuntimeException('kanal 15 sibuk');
            }
        };
        (new SpeakAnnouncement($camera->id, 'teks', [12, 15], 'do-backlog'))->handle($tts, $speaker);
        Queue::assertPushedOn('alerts', ReportAnnouncementToSlm::class, fn ($job) => $job->report === 'do-backlog' && $job->played === [12] && $job->failed === [15]);

        (new SpeakAnnouncement($camera->id, 'teks', [12]))->handle($tts, $speaker);
        Queue::assertPushed(ReportAnnouncementToSlm::class, 1);

        // Gagal di semua kanal: tidak dilaporkan dari handle(), baru dari failed() setelah percobaan terakhir.
        $job = new SpeakAnnouncement($camera->id, 'teks', [15], 'do-backlog');
        try { $job->handle($tts, $speaker); } catch (\RuntimeException) {}
        Queue::assertPushed(ReportAnnouncementToSlm::class, 1);
        $job->failed(new \RuntimeException('x'));
        Queue::assertPushed(ReportAnnouncementToSlm::class, fn ($job) => $job->played === [] && $job->failed === [15] && $job->error === 'RuntimeException');
    }

    public function test_result_is_posted_to_slm_with_the_cctv_token_and_without_the_text(): void
    {
        Http::fake(['*' => Http::response(['success' => true])]);
        Config::set('cctv.slm_base_url', 'https://slm.test');
        Config::set('cctv.slm_token', 'tok-ann');
        (new ReportAnnouncementToSlm('do-backlog', [12, 15], []))->handle();
        Http::assertSent(fn ($request) => $request->url() === 'https://slm.test/api/cctv/announcements/result'
            && $request->header('X-CCTV-Token') === ['tok-ann']
            && $request['report'] === 'do-backlog' && $request['played_channels'] === [12, 15] && !isset($request['text']));
    }
}

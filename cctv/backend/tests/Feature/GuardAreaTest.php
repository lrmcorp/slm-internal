<?php

namespace Tests\Feature;

use App\Jobs\SendSlmWebhookNotification;
use App\Jobs\SpeakGuardWarning;
use App\Models\Camera;
use App\Models\Incident;
use App\Models\User;
use App\Services\CameraSpeaker;
use App\Services\IsapiTalkSocket;
use App\Services\GuardSchedule;
use App\Services\TextToSpeech;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class GuardAreaTest extends TestCase
{
    use RefreshDatabase;

    private const ZONE = [[0.1, 0.1], [0.6, 0.1], [0.6, 0.9], [0.1, 0.9]];

    private function camera(array $overrides = []): Camera
    {
        static $n = 0;
        $n++;
        return Camera::create(array_merge([
            'name' => 'Camera 14', 'stream_env_key' => "CCTV_CAMERA_9{$n}_URL",
            'zones' => array_merge(Camera::DEFAULT_FULL_FRAME_ZONES, [['type' => 'restricted_zone', 'points' => self::ZONE]]),
            'guard_enabled' => true, 'guard_days' => [1, 2, 3, 4, 5, 6], 'guard_start' => '12:00', 'guard_end' => '15:00',
            'zones_approved_at' => now(),
        ], $overrides));
    }

    private function snapshot(): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('frame.jpg', base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9ZkAAAAASUVORK5CYII='
        ));
    }

    private function postGuard(Camera $camera)
    {
        return $this->post("/api/ingest/cameras/{$camera->id}/guard", [
            'observed_at' => now()->toIso8601String(), 'person_count' => 1, 'confidence' => 0.88, 'snapshot' => $this->snapshot(),
        ], ['X-CCTV-Ingest-Token' => str_repeat('a', 64)]);
    }

    protected function setUp(): void
    {
        parent::setUp();
        config(['cctv.ingest_token' => str_repeat('a', 64), 'cctv.slm_base_url' => 'https://mkr.lrmslm.com', 'cctv.slm_token' => 't']);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        putenv('CCTV_CAMERA_14_SPEAKER_URL');
        parent::tearDown();
    }

    public function test_schedule_follows_days_and_hours_in_jakarta_time(): void
    {
        $camera = $this->camera();
        // 22 Nov 2026 Minggu, 24 Nov Selasa, 28 Nov Sabtu; WIB = UTC+7.
        $at = fn (string $wib) => Carbon::parse("{$wib} Asia/Jakarta");
        $this->assertFalse(GuardSchedule::isActive($camera, $at('2026-11-22 13:00')), 'Minggu tidak dijaga');
        $this->assertFalse(GuardSchedule::isActive($camera, $at('2026-11-24 11:59')));
        $this->assertTrue(GuardSchedule::isActive($camera, $at('2026-11-24 12:00')));
        $this->assertTrue(GuardSchedule::isActive($camera, $at('2026-11-24 14:59')));
        $this->assertFalse(GuardSchedule::isActive($camera, $at('2026-11-24 15:00')));
        $this->assertTrue(GuardSchedule::isActive($camera, $at('2026-11-28 12:30')), 'Sabtu dijaga');

        $night = $this->camera(['guard_start' => '22:00', 'guard_end' => '06:00', 'guard_days' => [6]]);
        $this->assertTrue(GuardSchedule::isActive($night, $at('2026-11-28 23:00')), 'Sabtu malam');
        $this->assertTrue(GuardSchedule::isActive($night, $at('2026-11-29 05:00')), 'dini hari Minggu milik jaga Sabtu');
        $this->assertFalse(GuardSchedule::isActive($night, $at('2026-11-29 23:00')));

        $this->assertFalse(GuardSchedule::isActive($this->camera(['guard_enabled' => false]), $at('2026-11-24 13:00')));
        $this->assertFalse(GuardSchedule::isActive($this->camera(['zones' => Camera::DEFAULT_FULL_FRAME_ZONES]), $at('2026-11-24 13:00')), 'tanpa zona');
    }

    public function test_heartbeat_tells_the_worker_whether_to_guard(): void
    {
        $camera = $this->camera();
        Carbon::setTestNow(Carbon::parse('2026-11-24 13:00 Asia/Jakarta'));
        $this->postJson("/api/ingest/cameras/{$camera->id}/heartbeat", ['status' => 'online'], ['X-CCTV-Ingest-Token' => str_repeat('a', 64)])
            ->assertOk()->assertJsonPath('guard.active', true)->assertJsonPath('guard.zone', self::ZONE)->assertJsonPath('guard.cooldown_seconds', 60);
        Carbon::setTestNow(Carbon::parse('2026-11-24 16:00 Asia/Jakarta'));
        $this->postJson("/api/ingest/cameras/{$camera->id}/heartbeat", ['status' => 'online'], ['X-CCTV-Ingest-Token' => str_repeat('a', 64)])
            ->assertOk()->assertJsonPath('guard.active', false);
    }

    public function test_person_in_restricted_area_creates_incident_notifies_slm_and_speaks_once_per_cooldown(): void
    {
        Storage::fake('local');
        Queue::fake();
        $camera = $this->camera(['speaker_enabled' => true]);
        Carbon::setTestNow(Carbon::parse('2026-11-24 13:00 Asia/Jakarta'));

        $this->postGuard($camera)->assertCreated();
        $incident = Incident::sole();
        $this->assertSame('restricted_entry', $incident->type);
        Storage::disk('local')->assertExists($incident->snapshot_path);
        Queue::assertPushed(SendSlmWebhookNotification::class, fn ($job) => $job->eventData['event_type'] === 'restricted_entry'
            && $job->eventData['severity'] === 'critical' && str_contains($job->eventData['title'], 'Area Terlarang'));
        Queue::assertPushed(SpeakGuardWarning::class, 1);

        Carbon::setTestNow(Carbon::parse('2026-11-24 13:00:30 Asia/Jakarta'));
        $this->postGuard($camera)->assertStatus(202)->assertJsonPath('accepted', false);
        Carbon::setTestNow(Carbon::parse('2026-11-24 13:01:05 Asia/Jakarta'));
        $this->postGuard($camera)->assertCreated();
        $this->assertSame(2, Incident::count());
        Queue::assertPushed(SpeakGuardWarning::class, 2);
    }

    public function test_reports_outside_the_schedule_or_without_speaker_are_handled(): void
    {
        Storage::fake('local');
        Queue::fake();
        $camera = $this->camera();
        Carbon::setTestNow(Carbon::parse('2026-11-22 13:00 Asia/Jakarta'));
        $this->postGuard($camera)->assertStatus(202);
        $this->assertSame(0, Incident::count());

        Carbon::setTestNow(Carbon::parse('2026-11-24 13:00 Asia/Jakarta'));
        $this->postGuard($camera)->assertCreated();
        Queue::assertNotPushed(SpeakGuardWarning::class);
        $this->post("/api/ingest/cameras/{$camera->id}/guard", ['observed_at' => now()->toIso8601String(), 'person_count' => 1, 'confidence' => 0.9, 'snapshot' => $this->snapshot()])
            ->assertUnauthorized();
    }

    public function test_tts_returns_raw_ulaw_and_is_cached(): void
    {
        Storage::fake('local');
        config(['cctv.tts_api_key' => 'k', 'cctv.tts_voice' => 'id-ID-Standard-A']);
        $samples = str_repeat("\x7F\xFF", 400);
        $wav = 'RIFF'.pack('V', 36 + strlen($samples)).'WAVEfmt '.pack('V', 18).str_repeat("\0", 18).'data'.pack('V', strlen($samples)).$samples;
        Http::fake(['texttospeech.googleapis.com/*' => Http::response(['audioContent' => base64_encode($wav)])]);
        $tts = app(TextToSpeech::class);
        $this->assertSame($samples, $tts->ulaw('Perhatian'));
        $this->assertSame($samples, $tts->ulaw('Perhatian'));
        Http::assertSentCount(1);
        Http::assertSent(fn (ClientRequest $r) => $r['voice']['languageCode'] === 'id-ID' && $r['audioConfig']['audioEncoding'] === 'MULAW'
            && $r['audioConfig']['sampleRateHertz'] === 8000 && $r['audioConfig']['effectsProfileId'] === ['small-bluetooth-speaker-class-device'] && $r['audioConfig']['volumeGainDb'] == 4 && $r->hasHeader('X-Goog-Api-Key', 'k'));
    }

    public function test_speaker_opens_session_streams_audio_and_closes(): void
    {
        putenv('CCTV_CAMERA_14_SPEAKER_URL=http://admin:p%40ss@100.118.114.23:8081');
        $camera = $this->camera(['speaker_channel' => 2, 'stream_env_key' => 'CCTV_CAMERA_14_URL']);
        Http::fake([
            '*/open' => Http::response('<TwoWayAudioSession><sessionId>abc123</sessionId></TwoWayAudioSession>'),
            '*' => Http::response('<ResponseStatus><statusCode>1</statusCode></ResponseStatus>'),
        ]);
        $talk = new class extends IsapiTalkSocket {
            public array $calls = [];
            public function stream(string $base, string $user, string $pass, string $uri, string $audio, int $bytesPerSecond = 8000): void
            {
                $this->calls[] = [$base, $user, $pass, $uri, strlen($audio)];
            }
        };
        $this->app->instance(IsapiTalkSocket::class, $talk);
        app(CameraSpeaker::class)->play($camera, str_repeat("\xFF", 1600));
        $urls = [];
        Http::assertSent(function (ClientRequest $r) use (&$urls) { $urls[] = $r->method().' '.$r->url(); return true; });
        $this->assertSame([
            'PUT http://100.118.114.23:8081/ISAPI/System/TwoWayAudio/channels/2/close',
            'PUT http://100.118.114.23:8081/ISAPI/System/TwoWayAudio/channels/2/open',
            'PUT http://100.118.114.23:8081/ISAPI/System/TwoWayAudio/channels/2/close',
        ], $urls);
        $this->assertSame([['http://100.118.114.23:8081', 'admin', 'p@ss', '/ISAPI/System/TwoWayAudio/channels/2/audioData', 2400 + 1600]], $talk->calls);
        $this->assertSame(['base' => 'http://100.118.114.23:8081', 'user' => 'admin', 'pass' => 'p@ss'], CameraSpeaker::endpoint($camera));
    }

    public function test_digest_header_matches_rfc_2617_example(): void
    {
        $header = IsapiTalkSocket::digest('Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
            'Mufasa', 'Circle Of Life', 'GET', '/dir/index.html', '0a4f113b');
        $this->assertStringContainsString('response="6629fae49393a05397450978507c4ef1"', $header);
        $this->assertStringContainsString('opaque="5ccc069c403ebaf9f0171e9517f40e41"', $header);
    }

    public function test_talk_socket_logs_in_with_digest_and_streams_raw_audio_after_the_answer(): void
    {
        $port = random_int(20000, 40000);
        $log = tempnam(sys_get_temp_dir(), 'talk');
        // DVR tiruan: tolak tanpa login (401 Digest), jawab 200 tanpa panjang, lalu terima suara mentah sampai ditutup.
        $server = <<<'PHP'
$srv = stream_socket_server("tcp://127.0.0.1:" . $argv[1]); $out = [];
for ($i = 0; $i < 2; $i++) {
    $c = stream_socket_accept($srv, 10); $head = '';
    while (!str_contains($head, "\r\n\r\n")) { $head .= fread($c, 1); }
    if (!str_contains($head, 'Authorization: Digest')) {
        fwrite($c, "HTTP/1.1 401 Unauthorized\r\n" . 'WWW-Authenticate: Digest realm="DVR", nonce="n1", qop="auth"' . "\r\nContent-Length: 0\r\n\r\n"); fclose($c); continue;
    }
    fwrite($c, "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\n\r\n");
    $t = microtime(true); $n = 0; while (!feof($c)) { $n += strlen((string) fread($c, 4096)); }
    $out = ['head' => $head, 'bytes' => $n, 'seconds' => microtime(true) - $t];
}
file_put_contents($argv[2], json_encode($out));
PHP;
        $proc = proc_open([PHP_BINARY, '-r', $server, '--', (string) $port, $log], [], $pipes);
        usleep(300_000);
        try {
            (new IsapiTalkSocket(200))->stream("http://127.0.0.1:{$port}", 'admin', 'pw', '/ISAPI/System/TwoWayAudio/channels/1/audioData', str_repeat("\x7F", 4000));
        } finally {
            proc_close($proc);
        }
        $result = json_decode((string) file_get_contents($log), true);
        $this->assertSame(4000, $result['bytes']);
        $this->assertStringContainsString("PUT /ISAPI/System/TwoWayAudio/channels/1/audioData HTTP/1.1\r\n", $result['head']);
        $this->assertStringContainsString('Content-Length: 0', $result['head']);
        $this->assertStringContainsString('uri="/ISAPI/System/TwoWayAudio/channels/1/audioData", qop=auth', $result['head']);
        // 0,5 detik suara: 0,2 detik dikirim di depan, sisanya mengikuti kecepatan putar.
        $this->assertGreaterThan(0.25, $result['seconds']);
    }

    public function test_failed_speech_is_recorded_on_the_incident(): void
    {
        Storage::fake('local');
        $camera = $this->camera(['speaker_enabled' => true]);
        $incident = Incident::create(['camera_id' => $camera->id, 'type' => 'restricted_entry', 'reason' => 'x', 'occurred_at' => now(), 'dedupe_key' => 'k1']);
        (new SpeakGuardWarning($camera->id, $incident->id))->handle(app(TextToSpeech::class), app(CameraSpeaker::class));
        $this->assertStringStartsWith('failed: ', $incident->fresh()->metadata['speaker']);
    }

    public function test_admin_saves_guard_settings_and_restricted_zone_keeps_packing_approval(): void
    {
        $admin = User::factory()->create(['is_admin' => true]);
        $camera = $this->camera(['guard_enabled' => false]);
        $approvedAt = $camera->zones_approved_at;
        $this->assertNotNull($approvedAt);

        $this->actingAs($admin)->post("/cameras/{$camera->id}/guard-settings", [
            'guard_enabled' => 1, 'speaker_enabled' => 1, 'guard_days' => [1, 2, 3, 4, 5, 6], 'guard_start' => '12:00', 'guard_end' => '15:00',
            'guard_message' => 'Mohon keluar dari area ini.', 'guard_cooldown_seconds' => 90, 'speaker_channel' => 1,
        ])->assertRedirect();
        $camera->refresh();
        $this->assertTrue($camera->guard_enabled);
        $this->assertSame([1, 2, 3, 4, 5, 6], $camera->guard_days);
        $this->assertSame('Mohon keluar dari area ini.', GuardSchedule::message($camera));

        $zones = array_merge(Camera::DEFAULT_FULL_FRAME_ZONES, [['type' => 'restricted_zone', 'points' => [[0.2, 0.2], [0.5, 0.2], [0.5, 0.5]]]]);
        $this->actingAs($admin)->putJson("/cameras/{$camera->id}/zones", ['zones' => $zones])->assertOk();
        $this->assertNotNull($camera->fresh()->zones_approved_at, 'mengubah area terlarang saja tidak membatalkan persetujuan');

        $camera->fresh()->applyFullFrameZones();
        $this->assertNotNull(GuardSchedule::zone($camera->fresh()), 'full-frame tidak menghapus area terlarang');

        $this->actingAs(User::factory()->create(['is_admin' => false]))->post("/cameras/{$camera->id}/guard-settings", [])->assertForbidden();
    }
}

<?php

namespace Tests\Feature;

use App\Jobs\SendIncidentNotification;
use App\Mail\IncidentAlert;
use App\Models\Camera;
use App\Models\Incident;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class EmailNotificationTest extends TestCase
{
    use RefreshDatabase;

    private function delivery(): int
    {
        $user = User::factory()->create();
        $camera = Camera::create(['name' => 'Packing A13', 'location' => 'Toko', 'stream_env_key' => 'CCTV_CAMERA_13_URL']);
        $incident = Incident::create(['camera_id' => $camera->id, 'type' => 'anomaly',
            'dedupe_key' => 'email-test', 'occurred_at' => now(), 'reason' => 'Barang melintasi batas',
            'snapshot_path' => 'evidence/test.jpg']);
        return DB::table('notification_deliveries')->insertGetId(['user_id' => $user->id,
            'incident_id' => $incident->id, 'channel' => 'email', 'status' => 'pending',
            'created_at' => now(), 'updated_at' => now()]);
    }

    public function test_email_contains_private_detail_link_and_photo_and_is_not_sent_twice(): void
    {
        Mail::fake();
        Storage::fake('local');
        Storage::disk('local')->put('evidence/test.jpg', 'test-image');
        config(['mail.default' => 'smtp']);
        $id = $this->delivery();
        $job = new SendIncidentNotification($id);
        $job->handle();
        $job->handle();
        Mail::assertSent(IncidentAlert::class, function ($mail) {
            return str_contains($mail->detailUrl, '/incidents/') && count($mail->attachments()) === 1
                && str_contains($mail->render(), 'perlu diperiksa');
        });
        Mail::assertSentCount(1);
        $this->assertDatabaseHas('notification_deliveries', ['id' => $id, 'status' => 'sent', 'attempts' => 1]);
    }

    public function test_logging_mailer_cannot_be_reported_as_sent(): void
    {
        Mail::fake();
        config(['mail.default' => 'log']);
        $id = $this->delivery();
        try {
            (new SendIncidentNotification($id))->handle();
            $this->fail('Logging transport should fail');
        } catch (\RuntimeException $e) {
            $this->assertSame('Email transport is not configured', $e->getMessage());
        }
        Mail::assertNothingSent();
        $this->assertDatabaseHas('notification_deliveries', ['id' => $id, 'status' => 'retrying']);
    }
}

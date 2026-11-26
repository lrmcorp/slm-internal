<?php

namespace Tests\Feature;

use App\Models\Camera;
use App\Models\Incident;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class PersonPathIncidentTest extends TestCase
{
    use RefreshDatabase;

    public function test_person_based_boundary_exit_is_stored_as_anomaly_marked_as_person_detection(): void
    {
        Storage::fake('local');
        Queue::fake();
        config(['cctv.ingest_token' => str_repeat('b', 64)]);
        $user = User::factory()->create();
        $camera = Camera::create(['name' => 'Camera 13', 'location' => 'Toko', 'stream_env_key' => 'CCTV_CAMERA_97_URL',
            'zones' => [['type' => 'store_boundary', 'points' => [[0, 0], [1, 0], [1, 1]]]],
            'zones_approved_at' => now(), 'zones_approved_by' => $user->id]);
        $snapshot = UploadedFile::fake()->createWithContent('frame.png', base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9ZkAAAAASUVORK5CYII='));

        $this->post("/api/ingest/cameras/{$camera->id}/incidents", [
            'source_event_id' => 'person-1', 'type' => 'anomaly', 'occurred_at' => '2026-11-26T08:30:00Z',
            'reason' => 'Orang keluar batas toko tanpa jalur pengemasan.', 'item_count' => 1,
            'exited_boundary' => true, 'passed_packing_route' => false, 'detector' => 'person', 'snapshot' => $snapshot,
        ], ['X-CCTV-Ingest-Token' => str_repeat('b', 64)])->assertCreated();

        $incident = Incident::sole();
        $this->assertSame('anomaly', $incident->type);
        $this->assertSame('person', $incident->metadata['detector']);
    }
}

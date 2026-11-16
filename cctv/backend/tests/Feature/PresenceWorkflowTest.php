<?php
namespace Tests\Feature;
use App\Models\Camera;
use App\Models\Incident;
use App\Models\PresenceTrack;
use App\Models\User;
use App\Services\IncidentNotifier;
use App\Services\PresenceMonitor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\DB;
use App\Jobs\SendIncidentNotification;
use Tests\TestCase;

class PresenceWorkflowTest extends TestCase
{
    use RefreshDatabase;
    private function camera(): Camera {
        return Camera::create(['name'=>'Camera 13','stream_env_key'=>'CCTV_CAMERA_13_URL',
            'status'=>'online','last_seen_at'=>now(),'frame_at'=>now(),
            'tracking_session'=>'session-a','detector_ready'=>true,'presence_alerts_enabled'=>true]);
    }
    private function track(Camera $camera): PresenceTrack {
        return PresenceTrack::create(['camera_id'=>$camera->id,'session_id'=>'session-a','track_id'=>'42',
            'first_seen_at'=>now()->subMinutes(10),'last_seen_at'=>now()->subSeconds(301)]);
    }
    public function test_absence_is_deduplicated_and_retains_uncertainty(): void {
        $camera=$this->camera();$track=$this->track($camera);
        app(PresenceMonitor::class)->check(app(IncidentNotifier::class));
        app(PresenceMonitor::class)->check(app(IncidentNotifier::class));
        $this->assertDatabaseCount('incidents',1);
        $this->assertDatabaseHas('incidents',['type'=>'person_absent','status'=>'needs_review']);
        $this->assertStringContainsString('ID pelacak berubah',Incident::first()->reason);
        $this->assertSame('unclassified',$track->fresh()->classification);
    }
    public function test_many_lost_tracks_produce_a_single_alert_per_camera(): void {
        $camera=$this->camera();
        foreach (range(1,12) as $id) {
            PresenceTrack::create(['camera_id'=>$camera->id,'session_id'=>'session-a','track_id'=>(string)$id,
                'first_seen_at'=>now()->subMinutes(10),'last_seen_at'=>now()->subSeconds(400 + $id)]);
        }
        app(PresenceMonitor::class)->check(app(IncidentNotifier::class));
        $this->assertDatabaseCount('incidents',1);
        $this->assertStringContainsString('11 track lain',Incident::first()->reason);
        $this->assertSame(0,PresenceTrack::whereNull('absence_alerted_at')->count());
        // Track lain yang hilang dalam jendela cooldown tidak membuat peringatan baru.
        PresenceTrack::create(['camera_id'=>$camera->id,'session_id'=>'session-a','track_id'=>'99',
            'first_seen_at'=>now()->subMinutes(10),'last_seen_at'=>now()->subSeconds(500)]);
        app(PresenceMonitor::class)->check(app(IncidentNotifier::class));
        $this->assertDatabaseCount('incidents',1);
    }
    public function test_offline_stale_frame_and_restarted_session_do_not_report_person_absent(): void {
        $camera=$this->camera();$this->track($camera);
        foreach ([['status'=>'offline'],['frame_at'=>now()->subMinute()],['tracking_session'=>'session-b']] as $change) {
            $camera->update(['status'=>'online','frame_at'=>now(),'tracking_session'=>'session-a']);
            $camera->update($change);
            app(PresenceMonitor::class)->check(app(IncidentNotifier::class));
            $this->assertDatabaseCount('incidents',0);
        }
    }
    public function test_threshold_can_be_adjusted_only_by_admin(): void {
        $camera=$this->camera();$track=$this->track($camera);
        $this->actingAs(User::factory()->create())->post('/cameras/'.$camera->id.'/presence-settings',
            ['absence_seconds'=>600,'presence_alerts_enabled'=>true])->assertForbidden();
        $this->actingAs(User::factory()->create(['is_admin'=>true]))->post('/cameras/'.$camera->id.'/presence-settings',
            ['absence_seconds'=>600,'presence_alerts_enabled'=>true])->assertRedirect();
        app(PresenceMonitor::class)->check(app(IncidentNotifier::class));
        $this->assertDatabaseCount('incidents',0);
    }
    public function test_observation_image_is_private_and_unknown_people_are_not_customers(): void {
        Storage::fake('local');config(['cctv.ingest_token'=>str_repeat('s',64)]);
        $camera=$this->camera();
        $photo=UploadedFile::fake()->createWithContent('frame.png',base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9ZkAAAAASUVORK5CYII='));
        $this->post('/api/ingest/cameras/'.$camera->id.'/observations',[
            'session_id'=>'session-a','detector_ready'=>true,'tracks'=>json_encode([['id'=>'42','box'=>[.1,.1,.5,.5]]]),
            'snapshot'=>$photo],['X-CCTV-Ingest-Token'=>str_repeat('s',64)])->assertOk();
        $this->assertDatabaseHas('presence_tracks',['classification'=>'unclassified','track_id'=>'42']);
        $this->getJson('/api/cameras/'.$camera->id.'/live-frame')->assertUnauthorized();
        $this->actingAs(User::factory()->create())->get('/cameras/'.$camera->id.'/live-frame')->assertOk();
    }
    public function test_person_snapshot_is_not_rewritten_on_every_observation(): void {
        Storage::fake('local');config(['cctv.ingest_token'=>str_repeat('s',64)]);
        $camera=$this->camera();
        $send=fn ($photo)=>$this->post('/api/ingest/cameras/'.$camera->id.'/observations',[
            'session_id'=>'session-a','detector_ready'=>true,'tracks'=>json_encode([['id'=>'7','box'=>[.1,.1,.5,.5]]]),
            'snapshot'=>$photo],['X-CCTV-Ingest-Token'=>str_repeat('s',64)])->assertOk();
        $send(UploadedFile::fake()->image('a.png',4,4));
        $path=PresenceTrack::where('track_id','7')->value('snapshot_path');
        $first=Storage::disk('local')->get($path);
        $send(UploadedFile::fake()->image('b.png',9,9));
        $this->assertSame($first,Storage::disk('local')->get($path));
        $this->assertDatabaseCount('presence_tracks',1);
    }
    public function test_live_video_requires_login_and_rejects_stale_frames(): void {
        Storage::fake('local');$camera=$this->camera();
        Storage::disk('local')->put("cctv/live-video/{$camera->id}/stream.m3u8", "#EXTM3U\nsegment000001.ts\n");
        $url='/cameras/'.$camera->id.'/live/stream.m3u8';
        $this->get($url)->assertRedirect('/login');
        $this->actingAs(User::factory()->create())->get($url)->assertOk()
            ->assertHeader('Content-Type','application/vnd.apple.mpegurl');
        $this->get('/cameras/'.$camera->id.'/live/not-allowed.txt')->assertNotFound();
        $camera->update(['frame_at'=>now()->subMinute()]);
        $this->get($url)->assertStatus(503);
        $camera->update(['frame_at'=>now()]);
        $playlistPath = Storage::disk('local')->path("cctv/live-video/{$camera->id}/stream.m3u8");
        touch($playlistPath, now()->subMinute()->timestamp);
        clearstatcache(true, $playlistPath);
        $this->get($url)->assertStatus(503);
    }

    public function test_whatsapp_uploads_private_image_and_uses_approved_image_template(): void {
        Storage::fake('local');Http::fake([
            'graph.facebook.com/*/media'=>Http::response(['id'=>'media-id']),
            'graph.facebook.com/*/messages'=>Http::response(['messages'=>[['id'=>'message-id']]]),
        ]);
        config(['cctv.wa_phone_number_id'=>'phone-id','cctv.wa_access_token'=>'test-token',
            'cctv.wa_template_name'=>'text_template','cctv.wa_image_template_name'=>'image_template',
            'app.url'=>'https://cctvslm.playgo.id']);
        $camera=$this->camera();$user=User::factory()->create();
        Storage::disk('local')->put('cctv/test.jpg',base64_decode('/9j/'));
        $incident=Incident::create(['camera_id'=>$camera->id,'type'=>'person_absent','status'=>'needs_review',
            'occurred_at'=>now(),'reason'=>'Track tidak terlihat; perlu diperiksa','dedupe_key'=>'unique',
            'snapshot_path'=>'cctv/test.jpg']);
        DB::table('notification_rules')->insert(['user_id'=>$user->id,'incident_type'=>'person_absent',
            'channel'=>'whatsapp','enabled'=>true,'whatsapp_number'=>'+628123456789']);
        $id=DB::table('notification_deliveries')->insertGetId(['incident_id'=>$incident->id,'user_id'=>$user->id,
            'channel'=>'whatsapp','status'=>'pending']);
        (new SendIncidentNotification($id))->handle();
        Http::assertSent(fn ($request)=>str_ends_with($request->url(),'/messages')
            && $request['template']['name']==='image_template'
            && $request['template']['components'][0]['parameters'][0]['image']['id']==='media-id');
        $this->assertDatabaseHas('notification_deliveries',['id'=>$id,'status'=>'sent']);
    }
    public function test_object_tracks_are_separate_from_people_and_require_active_detector(): void {
        Storage::fake('local');config(['cctv.ingest_token'=>str_repeat('s',64)]);
        $camera=$this->camera();
        $photo=UploadedFile::fake()->createWithContent('frame.png',base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9ZkAAAAASUVORK5CYII='));
        $body=['session_id'=>'session-b','detector_ready'=>true,'tracks'=>json_encode([['id'=>'p1','box'=>[.1,.1,.5,.5]]]),
            'objects'=>json_encode([['id'=>'b2','box'=>[.2,.2,.4,.4]]]),'snapshot'=>$photo];
        $url='/api/ingest/cameras/'.$camera->id.'/observations';$headers=['X-CCTV-Ingest-Token'=>str_repeat('s',64)];
        $this->post($url,$body,$headers)->assertOk();
        $this->assertDatabaseCount('presence_tracks',1);
        $this->assertSame('b2',$camera->fresh()->object_tracks[0]['id']);
        $this->actingAs(User::factory()->create())->getJson('/dashboard/state')->assertOk()
            ->assertJsonPath('cameras.0.people_count',1)->assertJsonPath('cameras.0.objects_count',1);
        $body['detector_ready']=false;$this->post($url,$body,$headers)->assertUnprocessable();
    }

}

<?php
namespace Tests\Feature;
use App\Jobs\SyncMatchedLabelToSlm;
use App\Jobs\MatchLabelToSlm;
use App\Models\Camera;
use App\Models\LabelRecord;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;
class PackingDashboardTest extends TestCase {
    use RefreshDatabase;
    private function label(array $values=[]): LabelRecord {
        $camera=Camera::firstOrCreate(['stream_env_key'=>'CCTV_CAMERA_14_URL'], ['name'=>'Camera 14']);
        return LabelRecord::create(array_merge(['camera_id'=>$camera->id,'field_one'=>'061026-23',
            'field_two'=>'TK HANSEL ASK','field_three'=>'MJ','confidence'=>1,'first_seen_at'=>now(),
            'last_seen_at'=>now(),'review_status'=>'confirmed','slm_status'=>'matched',
            'evidence_path'=>'cctv/label.png'], $values));
    }
    public function test_capture_is_not_packing_done_and_pending_reading_cannot_confirm_it(): void {
        Queue::fake();$label=$this->label(['review_status'=>'pending']);
        $this->postJson('/labels/'.$label->id.'/packing-complete')->assertUnauthorized();
        $this->actingAs(User::factory()->create())->postJson('/labels/'.$label->id.'/packing-complete')->assertUnprocessable();
        $this->assertNull($label->fresh()->packing_completed_at);Queue::assertNothingPushed();
    }
    public function test_packing_confirmation_is_idempotent_and_queues_updated_erp_event(): void {
        Queue::fake();$label=$this->label();$before=SyncMatchedLabelToSlm::fingerprint($label);
        $user=User::factory()->create();$url='/labels/'.$label->id.'/packing-complete';
        $this->actingAs($user)->postJson($url)->assertOk();$first=$label->fresh()->packing_completed_at;
        $this->travel(5)->minutes();$this->postJson($url)->assertOk();
        $this->assertTrue($label->fresh()->packing_completed_at->equalTo($first));
        $this->assertSame($user->id,$label->fresh()->packing_completed_by);
        $this->assertNotSame($before,SyncMatchedLabelToSlm::fingerprint($label->fresh()));
        Queue::assertPushed(SyncMatchedLabelToSlm::class,1);
    }
    public function test_dashboard_state_requires_login_and_includes_all_cameras_and_actual_sync_counts(): void {
        $label=$this->label(['packing_completed_at'=>now(),'slm_sync_status'=>'synced']);
        Camera::create(['name'=>'Camera 12','stream_env_key'=>'CCTV_CAMERA_12_URL']);
        $this->getJson('/dashboard/state')->assertUnauthorized();
        $this->actingAs(User::factory()->create())->getJson('/dashboard/state')->assertOk()
            ->assertJsonCount(2,'cameras')->assertJsonPath('totals.packed',1)->assertJsonPath('totals.synced',1)
            ->assertJsonPath('erp_configured',false)->assertSee('061026-23');
        $this->get('/')->assertOk()->assertSee('data-camera-id',false)->assertSee('Invoice Packing');
    }
    public function test_auto_sync_recovers_matched_and_unavailable_records_but_excludes_uncertain_readings(): void {
        Queue::fake();config(['cctv.slm_base_url'=>'https://mkr.lrmslm.com','cctv.slm_token'=>'test',
            'cctv.slm_sync_path'=>'/api/cctv/labels/sync']);
        $label=$this->label();
        LabelRecord::create(array_merge($label->getAttributes(),['id'=>null,'slm_status'=>'unavailable']));
        LabelRecord::create(array_merge($label->getAttributes(),['id'=>null,'review_status'=>'pending']));
        $this->artisan('cctv:auto-sync')->assertExitCode(0);
        Queue::assertPushed(SyncMatchedLabelToSlm::class,1);Queue::assertPushed(MatchLabelToSlm::class,1);
    }
    public function test_erp_must_acknowledge_saved_and_receives_distinct_packing_event(): void {
        Storage::fake('local');Storage::disk('local')->put('cctv/label.png','photo');
        config(['cctv.slm_base_url'=>'https://mkr.lrmslm.com','cctv.slm_token'=>'test',
            'cctv.slm_sync_path'=>'/api/cctv/labels/sync','app.url'=>'https://cctv.lrmslm.com']);
        $label=$this->label(['packing_completed_at'=>now()]);
        Http::fake(['mkr.lrmslm.com/*'=>Http::sequence()->push(['saved'=>true],202)->push(['saved'=>false],200)->push(['saved'=>true],200)]);
        for ($i=0; $i<2; $i++) {
            try {(new SyncMatchedLabelToSlm($label->id))->handle();$this->fail('Belum tersimpan harus gagal.');}
            catch (\RuntimeException $e) {$this->assertNotSame('synced',$label->fresh()->slm_sync_status);}
        }
        (new SyncMatchedLabelToSlm($label->id))->handle();
        Http::assertSent(fn($request)=>$request['event_type']==='packing_completed'
            && $request['invoice_number']==='061026-23' && $request['packing_completed_at']!==null);
        $this->assertSame('synced',$label->fresh()->slm_sync_status);
    }
    public function test_packing_change_during_http_does_not_mark_new_event_as_synced(): void {
        Storage::fake('local');Storage::disk('local')->put('cctv/label.png','photo');
        config(['cctv.slm_base_url'=>'https://mkr.lrmslm.com','cctv.slm_token'=>'test',
            'cctv.slm_sync_path'=>'/api/cctv/labels/sync','app.url'=>'https://cctv.lrmslm.com']);
        $label=$this->label();
        Http::fake(function () use ($label) {
            $label->update(['packing_completed_at'=>now(), 'slm_sync_status'=>'queued']);
            return Http::response(['saved'=>true],200);
        });
        (new SyncMatchedLabelToSlm($label->id))->handle();
        $this->assertNotNull($label->fresh()->packing_completed_at);
        $this->assertSame('not_ready',$label->fresh()->slm_sync_status);
        $this->assertNull($label->fresh()->slm_synced_at);
    }

    public function test_dashboard_state_pagination_links_point_to_root_dashboard_and_not_api_state(): void {
        $camera = Camera::create(['name' => 'Camera 1', 'stream_env_key' => 'CCTV_CAMERA_1_URL']);
        for ($i = 1; $i <= 20; $i++) {
            LabelRecord::create([
                'camera_id' => $camera->id,
                'field_one' => 'INV-' . str_pad((string) $i, 3, '0', STR_PAD_LEFT),
                'field_two' => 'Customer ' . $i,
                'field_three' => 'MJ',
                'confidence' => 1,
                'first_seen_at' => now()->subMinutes(25 - $i),
                'last_seen_at' => now()->subMinutes(25 - $i),
                'review_status' => 'confirmed',
                'slm_status' => 'matched',
                'evidence_path' => 'cctv/label.png',
            ]);
        }
        $user = User::factory()->create();
        $response = $this->actingAs($user)->getJson('/dashboard/state?section=labels');
        $response->assertOk();
        $html = $response->json('invoices_html');
        $this->assertStringContainsString('label_page=2', $html);
        $this->assertStringNotContainsString('/dashboard/state', $html);
    }

    public function test_manual_sync_requires_authentication(): void {
        $label = $this->label();
        $this->postJson('/labels/'.$label->id.'/sync')->assertUnauthorized();
        $this->postJson('/labels/sync-all')->assertUnauthorized();
    }

    public function test_manual_sync_queues_job_for_matched_label(): void {
        Queue::fake();
        $label = $this->label(['slm_sync_status' => 'error', 'slm_sync_error' => 'Timeout']);
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/labels/'.$label->id.'/sync');
        $response->assertOk();
        $this->assertSame('queued', $label->fresh()->slm_sync_status);
        $this->assertNull($label->fresh()->slm_sync_error);
        Queue::assertPushed(SyncMatchedLabelToSlm::class, 1);
    }

    public function test_manual_sync_rejects_unmatched_label(): void {
        Queue::fake();
        $label = $this->label(['slm_status' => 'not_found']);
        $user = User::factory()->create();

        $this->actingAs($user)->postJson('/labels/'.$label->id.'/sync')->assertUnprocessable();
        Queue::assertNothingPushed();
    }

    public function test_manual_sync_all_queues_matched_pending_labels(): void {
        Queue::fake();
        $label1 = $this->label(['field_one' => 'INV-001', 'slm_sync_status' => 'not_ready']);
        $label2 = $this->label(['field_one' => 'INV-002', 'slm_sync_status' => 'error']);
        $label3 = $this->label(['field_one' => 'INV-003', 'slm_sync_status' => 'synced']); // already synced
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/labels/sync-all');
        $response->assertOk()->assertJsonPath('queued_count', 2);
        Queue::assertPushed(SyncMatchedLabelToSlm::class, 2);
        $this->assertSame('queued', $label1->fresh()->slm_sync_status);
        $this->assertSame('queued', $label2->fresh()->slm_sync_status);
        $this->assertSame('synced', $label3->fresh()->slm_sync_status);
    }

    public function test_label_detail_page_renders_with_breadcrumb_and_action_panel(): void {
        $label = $this->label(['field_one' => '101026-31', 'field_two' => 'ARI BOGOR', 'field_three' => 'Aneka Jaya']);
        $user = User::factory()->create();

        $response = $this->actingAs($user)->get('/labels/'.$label->id);
        $response->assertOk();
        $response->assertSee('Daftar Label &amp; Invoice', false);
        $response->assertSee('Invoice 101026-31');
        $response->assertSee('Panel Verifikasi &amp; Integrasi ERP', false);
    }

    public function test_dashboard_state_is_shared_between_tabs_for_a_few_seconds(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user)->getJson('/dashboard/state')->assertOk();
        $this->assertTrue(\Illuminate\Support\Facades\Cache::has('cctv_dashboard_core'));
    }
}

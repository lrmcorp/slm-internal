<?php

namespace Tests\Feature;

use App\Http\Controllers\DashboardController;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ErpHealthCheckTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::forget('cctv_erp_health_check');
    }

    public function test_erp_health_unconfigured_when_missing_config(): void
    {
        config([
            'cctv.slm_base_url' => null,
            'cctv.slm_token' => null,
            'cctv.slm_sync_path' => null,
        ]);

        $user = User::factory()->create();
        $response = $this->actingAs($user)->getJson('/dashboard/state');

        $response->assertOk()
            ->assertJsonPath('erp_configured', false)
            ->assertJsonPath('erp_health.status', 'unconfigured')
            ->assertJsonPath('erp_health.label', 'Belum Diatur');
    }

    public function test_erp_health_connected_when_endpoint_responds_200(): void
    {
        config([
            'cctv.slm_base_url' => 'http://localhost:3000',
            'cctv.slm_token' => 'cctv-slm-token-2026',
            'cctv.slm_sync_path' => '/api/cctv/labels/sync',
            'cctv.slm_health_path' => '/api/health',
        ]);

        Http::fake([
            'http://localhost:3000/api/health' => Http::response(['status' => 'ok'], 200),
        ]);

        $user = User::factory()->create();
        $response = $this->actingAs($user)->getJson('/dashboard/state');

        $response->assertOk()
            ->assertJsonPath('erp_configured', true)
            ->assertJsonPath('erp_health.status', 'connected');

        $this->assertNotNull($response->json('erp_health.latency_ms'));
        $this->assertStringContainsString('Terhubung', $response->json('erp_health.label'));
    }

    public function test_erp_health_disconnected_when_connection_fails(): void
    {
        config([
            'cctv.slm_base_url' => 'http://localhost:3000',
            'cctv.slm_token' => 'cctv-slm-token-2026',
            'cctv.slm_sync_path' => '/api/cctv/labels/sync',
            'cctv.slm_health_path' => '/api/health',
        ]);

        Http::fake([
            'http://localhost:3000/api/health' => function () {
                throw new ConnectionException('Connection refused');
            },
        ]);

        $user = User::factory()->create();
        $response = $this->actingAs($user)->getJson('/dashboard/state');

        $response->assertOk()
            ->assertJsonPath('erp_configured', true)
            ->assertJsonPath('erp_health.status', 'disconnected')
            ->assertJsonPath('erp_health.label', 'Terputus')
            ->assertJsonPath('erp_health.latency_ms', null);
    }

    public function test_erp_health_degraded_when_endpoint_responds_500(): void
    {
        config([
            'cctv.slm_base_url' => 'http://localhost:3000',
            'cctv.slm_token' => 'cctv-slm-token-2026',
            'cctv.slm_sync_path' => '/api/cctv/labels/sync',
            'cctv.slm_health_path' => '/api/health',
        ]);

        Http::fake([
            'http://localhost:3000/api/health' => Http::response(['error' => 'server error'], 500),
        ]);

        $user = User::factory()->create();
        $response = $this->actingAs($user)->getJson('/dashboard/state');

        $response->assertOk()
            ->assertJsonPath('erp_configured', true)
            ->assertJsonPath('erp_health.status', 'degraded')
            ->assertJsonPath('erp_health.label', 'HTTP 500');
    }

    public function test_erp_health_is_cached_for_subsequent_calls(): void
    {
        config([
            'cctv.slm_base_url' => 'http://localhost:3000',
            'cctv.slm_token' => 'cctv-slm-token-2026',
            'cctv.slm_sync_path' => '/api/cctv/labels/sync',
            'cctv.slm_health_path' => '/api/health',
        ]);

        Http::fake([
            'http://localhost:3000/api/health' => Http::response(['status' => 'ok'], 200),
        ]);

        DashboardController::checkErpHealth();
        DashboardController::checkErpHealth();
        DashboardController::checkErpHealth();

        Http::assertSentCount(1);
    }

    public function test_dashboard_page_renders_health_pill(): void
    {
        config([
            'cctv.slm_base_url' => 'http://localhost:3000',
            'cctv.slm_token' => 'cctv-slm-token-2026',
            'cctv.slm_sync_path' => '/api/cctv/labels/sync',
            'cctv.slm_health_path' => '/api/health',
        ]);

        Http::fake([
            'http://localhost:3000/api/health' => Http::response(['status' => 'ok'], 200),
        ]);

        $user = User::factory()->create();
        $response = $this->actingAs($user)->get('/');

        $response->assertOk()
            ->assertSee('erp-health-pill')
            ->assertSee('erp-health-label')
            ->assertSee('ERP SLM:');
    }
}

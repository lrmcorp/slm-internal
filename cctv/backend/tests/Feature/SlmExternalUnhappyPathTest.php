<?php

namespace Tests\Feature;

use App\Jobs\SendSlmWebhookNotification;
use App\Models\Camera;
use App\Models\Incident;
use App\Models\LabelRecord;
use App\Services\SlmWebhookDispatcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class SlmExternalUnhappyPathTest extends TestCase
{
    use RefreshDatabase;

    private string $validToken = 'secret-slm-integration-token-12345';

    protected function setUp(): void
    {
        parent::setUp();
        Config::set('cctv.slm_token', $this->validToken);
        Config::set('cctv.slm_base_url', 'https://mkr.lrmslm.com');
        Config::set('cctv.slm_events_path', '/api/cctv/events');
        Config::set('cctv.slm_webhook_enabled', true);
    }

    /**
     * UNHAPPY PATH 1: Token Kosong atau Tidak Diset di Config
     * Jika admin lupa mengisi SLM_API_TOKEN di server, request harus ditolak aman (401),
     * bukan malah mengizinkan akses tanpa password.
     */
    public function test_unhappy_path_empty_or_unset_token_in_config_rejects_requests(): void
    {
        Config::set('cctv.slm_token', '');
        $this->withToken($this->validToken)
            ->getJson('/api/v1/slm/status')
            ->assertStatus(401)
            ->assertJsonPath('message', 'Unauthorized: Token autentikasi ERP SLM tidak valid atau belum diatur.');

        Config::set('cctv.slm_token', null);
        $this->withToken('')
            ->getJson('/api/v1/slm/status')
            ->assertStatus(401);
    }

    /**
     * UNHAPPY PATH 2: Variasi Serangan / Token Parsial & Malformed
     * Substring token, token berlebih, atau spasi kosong tidak boleh lolos.
     */
    public function test_unhappy_path_bearer_token_empty_spaces_or_prefix_only(): void
    {
        // Token hanya berupa potongan awal (prefix)
        $this->withToken(substr($this->validToken, 0, 10))
            ->getJson('/api/v1/slm/status')
            ->assertStatus(401);

        // Token kepanjangan
        $this->withToken($this->validToken . '-extra')
            ->getJson('/api/v1/slm/status')
            ->assertStatus(401);

        // Header kosong
        $this->withHeaders(['Authorization' => 'Bearer '])
            ->getJson('/api/v1/slm/status')
            ->assertStatus(401);

        // Header dengan spasi
        $this->withToken('   ')
            ->getJson('/api/v1/slm/status')
            ->assertStatus(401);
    }

    /**
     * UNHAPPY PATH 3: Input Malicious & SQLi / XSS pada Invoice Lookup
     * Karakter jahat pada URL tidak boleh memicu SQL Injection atau 500 error.
     */
    public function test_unhappy_path_invoice_query_with_malicious_or_empty_inputs(): void
    {
        // Input kosong / whitespace
        $this->withToken($this->validToken)
            ->getJson('/api/v1/slm/invoices/%20%20%20')
            ->assertStatus(422)
            ->assertJsonPath('found', false);

        // XSS Payload
        $xss = urlencode('<script>alert("hack")</script>');
        $this->withToken($this->validToken)
            ->getJson("/api/v1/slm/invoices/{$xss}")
            ->assertStatus(404)
            ->assertJsonPath('found', false);

        // SQL Injection Payload
        $sqli = urlencode("' OR 1=1 --");
        $this->withToken($this->validToken)
            ->getJson("/api/v1/slm/invoices/{$sqli}")
            ->assertStatus(404)
            ->assertJsonPath('found', false);
    }

    /**
     * UNHAPPY PATH 4: Data Invoice dengan Field Null & Boundary Values
     * Label dengan customer null, store null, confidence 0, dan belum packing tidak boleh meledak.
     */
    public function test_unhappy_path_invoice_with_null_and_boundary_fields(): void
    {
        $camera = Camera::create([
            'name' => 'Kamera Meja 1',
            'stream_env_key' => 'STREAM_CAMERA_UNHAPPY_1',
        ]);

        $label = LabelRecord::create([
            'camera_id' => $camera->id,
            'field_one' => '121026-88',
            'field_two' => null, // Customer null
            'field_three' => null, // Store null
            'confidence' => 0.0,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
            'packing_completed_at' => null,
            'slm_reference' => null,
        ]);

        $res = $this->withToken($this->validToken)->getJson('/api/v1/slm/invoices/121026-88');
        $res->assertOk()
            ->assertJsonPath('found', true)
            ->assertJsonPath('invoice_number', '121026-88')
            ->assertJsonPath('customer_name', null)
            ->assertJsonPath('store_source', null)
            ->assertJsonPath('packing_status', 'in_progress')
            ->assertJsonPath('slm_reference', null)
            ->assertJsonPath('camera_name', 'Kamera Meja 1');
    }

    /**
     * UNHAPPY PATH 5: Parameter Ekstrem pada Query Events
     * Limit negatif, limit jutaan, parameter tanggal invalid tidak boleh membuat query meledak.
     */
    public function test_unhappy_path_events_extreme_and_corrupt_parameters(): void
    {
        // Limit negatif dijepit ke minimal 1
        $resNeg = $this->withToken($this->validToken)->getJson('/api/v1/slm/events?limit=-50');
        $resNeg->assertOk();

        // Limit raksasa dijepit ke maksimal 100
        $resMax = $this->withToken($this->validToken)->getJson('/api/v1/slm/events?limit=99999999');
        $resMax->assertOk();

        // Parameter limit huruf/bukan angka
        $resAlpha = $this->withToken($this->validToken)->getJson('/api/v1/slm/events?limit=abc');
        $resAlpha->assertOk();

        // Parameter since berupa teks sampah / SQLi
        $resSince = $this->withToken($this->validToken)->getJson('/api/v1/slm/events?since=bukan-tanggal-valid-OR-1=1');
        $resSince->assertOk();

        // Tipe event yang tidak dikenal
        $resUnknown = $this->withToken($this->validToken)->getJson('/api/v1/slm/events?type=TIPE_TIDAK_ADA');
        $resUnknown->assertOk()
            ->assertJsonPath('count', 0);
    }

    /**
     * UNHAPPY PATH 6: Tabel Kosong & Data Null pada Summary Packing
     */
    public function test_unhappy_path_packing_summary_with_zero_data_or_null_fields(): void
    {
        // Database kosong hari ini
        $res = $this->withToken($this->validToken)->getJson('/api/v1/slm/packing/summary');
        $res->assertOk()
            ->assertJsonPath('total_scanned_today', 0)
            ->assertJsonPath('total_packed_today', 0);

        $camera = Camera::create([
            'name' => 'Meja Packing 1',
            'stream_env_key' => 'STREAM_TEST_SUMMARY_KEY',
        ]);

        // Ada data tetapi field_three null
        LabelRecord::create([
            'camera_id' => $camera->id,
            'field_one' => '121026-77',
            'field_three' => null, // null store
            'confidence' => 0.9,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
            'packing_completed_at' => now(),
        ]);

        $resWithNull = $this->withToken($this->validToken)->getJson('/api/v1/slm/packing/summary');
        $resWithNull->assertOk()
            ->assertJsonPath('total_packed_today', 1)
            ->assertJsonPath('by_store.Lain-lain', 1);
    }

    /**
     * UNHAPPY PATH 7: Server ERP SLM Down / Error 500
     * Job Webhook HARUS melempar RuntimeException agar antrean queue me-retry otomatis!
     */
    public function test_unhappy_path_webhook_erp_server_error_500_triggers_retry_exception(): void
    {
        Http::fake([
            'mkr.lrmslm.com/*' => Http::response('Internal Server Error', 500),
        ]);

        $job = new SendSlmWebhookNotification([
            'event_id' => 'evt-err-500',
            'event_type' => 'anomaly',
        ]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('SLM ERP responded with server error HTTP 500');

        $job->handle();
    }

    /**
     * UNHAPPY PATH 8: Server ERP SLM Menolak Client Error (HTTP 401 / 400)
     * Tidak boleh rethrow yang memicu badai retry sia-sia bila penolakan bersifat permanen.
     */
    public function test_unhappy_path_webhook_erp_client_error_400_does_not_throw(): void
    {
        Http::fake([
            'mkr.lrmslm.com/*' => Http::response(['message' => 'Bad Request'], 400),
        ]);

        $job = new SendSlmWebhookNotification([
            'event_id' => 'evt-bad-req',
            'event_type' => 'anomaly',
        ]);

        // Harus selesai tanpa throw exception
        $job->handle();
        $this->assertTrue(true);
    }

    /**
     * UNHAPPY PATH 9: Konfigurasi SLM_BASE_URL Kosong atau SSRF Disallowed
     * Job harus batal aman tanpa memanggil HTTP keluar yang berbahaya.
     */
    public function test_unhappy_path_webhook_disallows_ssrf_and_handles_missing_config(): void
    {
        Http::fake();

        // 1. URL kosong
        Config::set('cctv.slm_base_url', '');
        (new SendSlmWebhookNotification(['event_id' => '1']))->handle();
        Http::assertNothingSent();

        // 2. Token kosong
        Config::set('cctv.slm_base_url', 'https://mkr.lrmslm.com');
        Config::set('cctv.slm_token', '');
        (new SendSlmWebhookNotification(['event_id' => '2']))->handle();
        Http::assertNothingSent();

        // 3. SSRF URL Scheme (file://, ftp://)
        Config::set('cctv.slm_token', 'valid-token');
        Config::set('cctv.slm_base_url', 'file:///etc/passwd');
        (new SendSlmWebhookNotification(['event_id' => '3']))->handle();
        Http::assertNothingSent();

        // 4. Webhook disabled via config
        Config::set('cctv.slm_base_url', 'https://mkr.lrmslm.com');
        Config::set('cctv.slm_webhook_enabled', false);
        (new SendSlmWebhookNotification(['event_id' => '4']))->handle();
        Http::assertNothingSent();
    }

    /**
     * UNHAPPY PATH 10: Dispatcher Menangani Record Tanpa Kamera / Metadata Kosong
     */
    public function test_unhappy_path_dispatcher_handles_null_camera_and_metadata(): void
    {
        Queue::fake();

        // Incident tanpa kamera relasi, tanpa reason panjang, tanpa metadata
        $incident = new Incident([
            'camera_id' => 9999,
            'type' => 'anomaly',
            'status' => 'needs_review',
            'occurred_at' => now(),
            'dedupe_key' => 'dedupe-orphan',
            'metadata' => null,
            'reason' => 'Anomali terdeteksi tanpa detail',
        ]);
        $incident->id = 9999;
        $incident->setRelation('camera', null);

        app(SlmWebhookDispatcher::class)->dispatchIncident($incident);

        Queue::assertPushed(SendSlmWebhookNotification::class, function ($job) {
            return $job->eventData['camera']['name'] === 'Kamera Meja Packing'
                && $job->eventData['data']['item_count'] === null;
        });

        // Label tanpa kamera relasi, tanpa customer, tanpa invoice
        $label = new LabelRecord([
            'camera_id' => 9999,
            'field_one' => '',
            'field_two' => null,
            'confidence' => 0.5,
            'first_seen_at' => now(),
            'last_seen_at' => now(),
            'packing_completed_at' => null,
        ]);
        $label->id = 9999;
        $label->setRelation('camera', null);

        app(SlmWebhookDispatcher::class)->dispatchPackingCompleted($label);

        Queue::assertPushed(SendSlmWebhookNotification::class, function ($job) {
            return ($job->eventData['event_type'] ?? '') === 'packing_completed'
                && in_array($job->eventData['data']['invoice_number'] ?? null, ['', null], true)
                && str_contains($job->eventData['title'], 'Tanpa Nomor');
        });
    }
}

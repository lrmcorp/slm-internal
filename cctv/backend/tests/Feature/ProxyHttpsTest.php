<?php

namespace Tests\Feature;

use Tests\TestCase;

class ProxyHttpsTest extends TestCase
{
    public function test_assets_use_https_behind_proxy(): void
    {
        config(['app.url' => 'http://localhost']);

        $this->get('/login', ['X-Forwarded-Proto' => 'https', 'X-Forwarded-Host' => 'cctv.lrmslm.com'])
            ->assertOk()
            ->assertSee('https://cctv.lrmslm.com/css/dashboard.css', false);
    }
}

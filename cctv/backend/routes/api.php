<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\CctvController;
use App\Http\Controllers\Api\IngestController;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\PresenceController;

Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:5,1');

Route::prefix('ingest')->middleware('cctv.ingest')->group(function () {
    Route::get('/cameras/{camera}/config', [IngestController::class, 'config']);
    Route::post('/cameras/{camera}/observations', [PresenceController::class, 'ingest']);
    Route::post('/cameras/{camera}/heartbeat', [IngestController::class, 'heartbeat']);
    Route::post('/cameras/{camera}/labels', [IngestController::class, 'label']);
    Route::post('/cameras/{camera}/incidents', [IngestController::class, 'incident']);
    Route::post('/cameras/{camera}/incidents/{sourceEventId}/clip', [IngestController::class, 'clip']);
});

Route::middleware('api.token')->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::post('/devices', [AuthController::class, 'device']);
    Route::get('/reports/presence', [PresenceController::class, 'reports']);
    Route::post('/presence/{track}/classification', [PresenceController::class, 'classify']);
    Route::put('/cameras/{camera}/presence-settings', [PresenceController::class, 'settings']);
    Route::get('/cameras/{camera}/live/{file}', [PresenceController::class, 'video']);
    Route::get('/cameras/{camera}/live-frame', [PresenceController::class, 'live']);
    Route::get('/cameras/{camera}/stream', [PresenceController::class, 'stream']);
    Route::get('/cameras', [CctvController::class, 'cameras']);
    Route::post('/cameras', [CctvController::class, 'createCamera']);
    Route::post('/cameras/{camera}/reference', [CctvController::class, 'uploadReference']);
    Route::put('/cameras/{camera}/zones', [CctvController::class, 'zones']);
    Route::post('/cameras/{camera}/zones/approve', [CctvController::class, 'approveZones']);
    Route::get('/labels', [CctvController::class, 'labels']);
    Route::get('/labels/{label}', [CctvController::class, 'label']);
    Route::post('/labels/{label}/packing-complete', [\App\Http\Controllers\PackingController::class, 'complete']);
    Route::post('/labels/{label}/review', [CctvController::class, 'reviewLabel']);
    Route::get('/incidents', [CctvController::class, 'incidents']);
    Route::get('/incidents/{incident}', [CctvController::class, 'incident']);
    Route::post('/incidents/{incident}/review', [CctvController::class, 'review']);
    Route::match(['get', 'put'], '/notification-rules', [CctvController::class, 'rules']);
    Route::get('/evidence/{kind}/{id}', [CctvController::class, 'evidence']);
});

Route::prefix('v1/slm')->middleware('slm.auth')->group(function () {
    Route::get('/status', [\App\Http\Controllers\Api\SlmExternalController::class, 'status']);
    Route::get('/cameras/{camera}/stream', [PresenceController::class, 'stream']);
    Route::get('/cameras/{camera}/live-frame', [PresenceController::class, 'live']);
    Route::get('/cameras/{camera}/live/{file}', [PresenceController::class, 'video']);
    Route::get('/invoices/{invoice}', [\App\Http\Controllers\Api\SlmExternalController::class, 'invoice'])->where('invoice', '.*');
    Route::get('/events', [\App\Http\Controllers\Api\SlmExternalController::class, 'events']);
    Route::get('/packing/summary', [\App\Http\Controllers\Api\SlmExternalController::class, 'packingSummary']);
    Route::match(['GET', 'OPTIONS'], '/evidence/{kind}/{id}', [\App\Http\Controllers\Api\SlmExternalController::class, 'evidence']);
});

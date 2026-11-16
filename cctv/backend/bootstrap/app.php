<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // shortcut: percaya semua proxy; aman karena port web hanya dijangkau NPM, perketat bila terbuka publik.
        $middleware->trustProxies(at: '*');
        $middleware->alias([
            'api.token' => \App\Http\Middleware\AuthenticateApiToken::class,
            'cctv.ingest' => \App\Http\Middleware\AuthenticateIngest::class,
            'slm.auth' => \App\Http\Middleware\VerifySlmApiToken::class,
            'stream.auth' => \App\Http\Middleware\AuthenticateStreamAccess::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();

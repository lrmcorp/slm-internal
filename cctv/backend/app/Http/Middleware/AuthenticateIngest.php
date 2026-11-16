<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateIngest
{
    public function handle(Request $request, Closure $next): Response
    {
        $expected = config('cctv.ingest_token');
        $provided = $request->header('X-CCTV-Ingest-Token', '');
        if (!is_string($expected) || strlen($expected) < 32 || !hash_equals($expected, $provided)) {
            return response()->json(['message' => 'Unauthorized.'], 401);
        }
        return $next($request);
    }
}

<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class VerifySlmApiToken
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->isMethod('OPTIONS')) {
            return response('', 204)
                ->header('Access-Control-Allow-Origin', '*')
                ->header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
                ->header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-CCTV-Token, X-SLM-Token, X-CCTV-Signature');
        }

        $expected = (string) config('cctv.slm_token');
        $provided = (string) ($request->bearerToken()
            ?: $request->header('X-SLM-Token')
            ?: $request->header('X-CCTV-Token')
            ?: $request->query('token')
            ?: '');

        if ($expected === '' || !hash_equals($expected, $provided)) {
            return response()->json([
                'message' => 'Unauthorized: Token autentikasi ERP SLM tidak valid atau belum diatur.',
            ], 401);
        }

        $response = $next($request);
        $response->headers->set('Access-Control-Allow-Origin', '*');

        return $response;
    }
}

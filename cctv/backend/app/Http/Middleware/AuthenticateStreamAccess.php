<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateStreamAccess
{
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->isMethod('OPTIONS')) {
            return response('', 204)
                ->header('Access-Control-Allow-Origin', '*')
                ->header('Access-Control-Allow-Methods', 'GET, OPTIONS')
                ->header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-CCTV-Token, X-SLM-Token');
        }

        // 1. Autentikasi Web Session (login di dashboard cctvslm)
        if (auth()->guard('web')->check()) {
            return $next($request);
        }

        // 2. Autentikasi Token Integrasi ERP SLM (Bearer, Header, atau Query String)
        $expected = (string) config('cctv.slm_token');
        $provided = (string) ($request->bearerToken()
            ?: $request->header('X-SLM-Token')
            ?: $request->header('X-CCTV-Token')
            ?: $request->query('token')
            ?: '');

        if ($expected !== '' && $provided !== '' && hash_equals($expected, $provided)) {
            $response = $next($request);
            $response->headers->set('Access-Control-Allow-Origin', '*');
            return $response;
        }

        // 3. Autentikasi Token Pengguna Mobile App (api_tokens)
        if ($bearer = $request->bearerToken()) {
            if (strlen($bearer) === 64 && ctype_xdigit($bearer)) {
                $record = DB::table('api_tokens')->where('token_hash', hash('sha256', $bearer))
                    ->where('expires_at', '>', now())->first();
                if ($record && $user = \App\Models\User::find($record->user_id)) {
                    auth()->setUser($user);
                    return $next($request);
                }
            }
        }

        // 4. Akses ditolak
        if ($request->expectsJson() || $request->is('api/*')) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        return redirect()->guest(route('login'));
    }
}


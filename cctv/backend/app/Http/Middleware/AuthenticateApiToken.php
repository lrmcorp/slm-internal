<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateApiToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->bearerToken();
        if (!$token || strlen($token) !== 64 || !ctype_xdigit($token)) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $record = DB::table('api_tokens')->where('token_hash', hash('sha256', $token))
            ->where('expires_at', '>', now())->first();
        if (!$record || !$user = \App\Models\User::find($record->user_id)) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        DB::table('api_tokens')->where('id', $record->id)->update(['last_used_at' => now()]);
        $request->setUserResolver(fn () => $user);
        auth()->setUser($user);

        return $next($request);
    }
}

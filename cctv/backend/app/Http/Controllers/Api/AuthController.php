<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class AuthController extends Controller
{
    public function login(Request $request)
    {
        $data = $request->validate(['email' => 'required|email', 'password' => 'required|string']);
        $user = User::where('email', $data['email'])->first();
        if (!$user || !Hash::check($data['password'], $user->password)) {
            return response()->json(['message' => 'Kredensial tidak valid.'], 401);
        }

        $token = bin2hex(random_bytes(32));
        DB::table('api_tokens')->insert([
            'user_id' => $user->id, 'name' => 'flutter', 'token_hash' => hash('sha256', $token),
            'expires_at' => now()->addDays(30), 'created_at' => now(), 'updated_at' => now(),
        ]);
        return response()->json(['token' => $token, 'expires_at' => now()->addDays(30)->toIso8601String(),
            'user' => $user->only(['id', 'name', 'email'])]);
    }

    public function logout(Request $request)
    {
        DB::table('api_tokens')->where('token_hash', hash('sha256', $request->bearerToken()))->delete();
        return response()->noContent();
    }

    public function device(Request $request)
    {
        $data = $request->validate(['token' => 'required|string|max:4096', 'platform' => 'required|in:android,ios']);
        $hash = hash('sha256', $data['token']);
        DB::table('device_tokens')->updateOrInsert(['token_hash' => $hash], [
            'user_id' => $request->user()->id,
            'token_encrypted' => encrypt($data['token']),
            'platform' => $data['platform'], 'created_at' => now(), 'updated_at' => now(),
        ]);
        return response()->json(['registered' => true]);
    }
}

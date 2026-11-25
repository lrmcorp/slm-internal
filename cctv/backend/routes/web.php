<?php

use App\Models\Camera;
use App\Models\Incident;
use App\Models\LabelRecord;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

Route::get('/login', fn () => view('login'))->middleware('guest')->name('login');
Route::post('/login', function (Request $request) {
    $data = $request->validate(['email' => 'required|email', 'password' => 'required|string']);
    if (!Auth::attempt($data)) {
        return back()->withErrors(['email' => 'Email atau kata sandi tidak cocok.']);
    }
    $request->session()->regenerate();
    return redirect()->intended('/');
})->middleware(['guest', 'throttle:5,1']);

Route::middleware('auth')->group(function () {
    Route::post('/logout', function (Request $request) {
        Auth::logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();
        return redirect('/login');
    })->name('logout');

    Route::get('/reports', function (Request $request, \App\Http\Controllers\Api\PresenceController $controller) {
        $request->validate(['from' => 'nullable|date', 'to' => 'nullable|date|after_or_equal:from']);
        foreach (['from', 'to'] as $field) {
            if ($request->query($field)) {
                $request->merge([$field => \Carbon\Carbon::parse($request->query($field), 'Asia/Jakarta')->toIso8601String()]);
            }
        }
        return view('reports', ['tracks' => $controller->reports($request)]);
    })->name('dashboard.reports');
    Route::post('/presence/{track}/classification', [\App\Http\Controllers\Api\PresenceController::class, 'classify']);
    Route::post('/cameras/{camera}/presence-settings', function (Request $request, Camera $camera,
        \App\Http\Controllers\Api\PresenceController $controller) {
        $controller->settings($request, $camera);
        return back();
    });
    Route::get('/dashboard/state', [\App\Http\Controllers\DashboardController::class, 'state']);
    Route::get('/', fn () => view('dashboard', [
        'totals' => \App\Http\Controllers\DashboardController::totals(),
        'cameras' => Camera::orderBy('name')->get(),
        'labels' => LabelRecord::with('camera')->latest('first_seen_at')->paginate(15, ['*'], 'label_page'),
        'incidents' => Incident::with('camera')->latest('occurred_at')->paginate(15, ['*'], 'incident_page'),
        'rules' => DB::table('notification_rules')->join('users', 'users.id', '=', 'notification_rules.user_id')
            ->when(!Auth::user()->is_admin, fn ($q) => $q->where('user_id', Auth::id()))
            ->select('notification_rules.*', 'users.email')->get(),
        'users' => Auth::user()->is_admin ? User::orderBy('name')->get() : collect([Auth::user()]),
    ]))->name('dashboard');

    Route::post('/users', function (Request $request) {
        abort_unless($request->user()->is_admin, 403);
        $data = $request->validate(['name' => 'required|string|max:100', 'email' => 'required|email|unique:users,email',
            'password' => 'required|string|min:12']);
        User::create($data);
        return back();
    });

    Route::post('/cameras', function (Request $request) {
        abort_unless($request->user()->is_admin, 403);
        $data = $request->validate([
            'name' => 'required|string|max:100', 'location' => 'nullable|string|max:100',
            'stream_env_key' => ['required', 'regex:/^CCTV_CAMERA_[0-9]+_URL$/', 'unique:cameras,stream_env_key'],
        ]);
        $camera = Camera::create($data);
        return redirect()->route('dashboard.camera', $camera);
    });

    Route::get('/cameras/{camera}', fn (Camera $camera) => view('camera', ['camera' => $camera]))
        ->name('dashboard.camera');
    Route::post('/cameras/{camera}/reference', function (Request $request, Camera $camera) {
        $request->validate(['image' => 'required|image|max:4096']);
        if ($camera->reference_path) {
            \Illuminate\Support\Facades\Storage::disk('local')->delete($camera->reference_path);
        }
        $camera->update(['reference_path' => $request->file('image')->store('cctv/references', 'local'),
            'zones_approved_at' => null, 'zones_approved_by' => null]);
        return back();
    });
    Route::put('/cameras/{camera}/zones', function (Request $request, Camera $camera,
        \App\Http\Controllers\Api\CctvController $controller) {
        abort_unless($request->user()->is_admin, 403);
        return $controller->zones($request, $camera);
    });
    Route::post('/cameras/{camera}/zones/approve', function (Request $request, Camera $camera,
        \App\Http\Controllers\Api\CctvController $controller) {
        $response = $controller->approveZones($request, $camera);
        if ($response instanceof \Illuminate\Http\JsonResponse) {
            return $response;
        }
        return back();
    });
    Route::post('/cameras/{camera}/guard-settings', function (Request $request, Camera $camera) {
        abort_unless($request->user()->is_admin, 403);
        $data = $request->validate([
            'guard_enabled' => 'nullable|boolean', 'speaker_enabled' => 'nullable|boolean',
            'guard_days' => 'nullable|array', 'guard_days.*' => 'integer|between:1,7',
            'guard_start' => ['required', 'regex:/^([01]\d|2[0-3]):[0-5]\d$/'], 'guard_end' => ['required', 'regex:/^([01]\d|2[0-3]):[0-5]\d$/'],
            'guard_message' => 'nullable|string|max:300', 'guard_cooldown_seconds' => 'required|integer|between:10,3600',
            'speaker_channel' => 'required|integer|between:1,64',
        ]);
        $camera->update([
            'guard_enabled' => $request->boolean('guard_enabled'), 'speaker_enabled' => $request->boolean('speaker_enabled'),
            'guard_days' => array_values(array_map('intval', $data['guard_days'] ?? [])),
            'guard_start' => $data['guard_start'], 'guard_end' => $data['guard_end'],
            'guard_message' => trim((string) ($data['guard_message'] ?? '')) ?: null,
            'guard_cooldown_seconds' => $data['guard_cooldown_seconds'], 'speaker_channel' => $data['speaker_channel'],
        ]);
        return back()->with('status', 'Pengaturan jaga area terlarang disimpan.');
    })->name('dashboard.camera.guard');
    Route::post('/cameras/{camera}/speaker-test', function (Request $request, Camera $camera,
        \App\Services\TextToSpeech $tts, \App\Services\CameraSpeaker $speaker) {
        abort_unless($request->user()->is_admin, 403);
        $text = trim((string) $request->input('text')) ?: \App\Services\GuardSchedule::message($camera);
        try {
            $speaker->play($camera, $tts->ulaw(mb_substr($text, 0, 300)));
        } catch (\Throwable $e) {
            return back()->with('speaker_error', 'Suara belum bisa diputar: '.$e->getMessage());
        }
        return back()->with('status', 'Suara uji sudah dikirim ke speaker kamera.');
    })->name('dashboard.camera.speaker-test');
    Route::post('/cameras/{camera}/zones/apply-full-frame', function (Request $request, Camera $camera) {
        abort_unless($request->user()->is_admin, 403);
        $camera->applyFullFrameZones(true);
        return back()->with('status', 'Mode Full-Frame Auto-Zone berhasil diterapkan dan disetujui.');
    })->name('dashboard.camera.apply-full-frame');

    Route::post('/labels/sync-all', [\App\Http\Controllers\PackingController::class, 'syncAll'])->name('dashboard.labels.sync-all');
    Route::get('/labels/{label}', fn (LabelRecord $label) => view('label', [
        'label' => $label->load('camera'),
    ]))->name('dashboard.label');
    Route::post('/labels/{label}/packing-complete', [\App\Http\Controllers\PackingController::class, 'complete']);
    Route::post('/labels/{label}/sync', [\App\Http\Controllers\PackingController::class, 'sync'])->name('dashboard.label.sync');
    Route::post('/labels/{label}/review', function (Request $request, LabelRecord $label,
        \App\Http\Controllers\Api\CctvController $controller, \App\Services\SlmMatcher $matcher) {
        $controller->reviewLabel($request, $label, $matcher);
        return back();
    });

    Route::get('/incidents/{incident}', fn (Incident $incident) => view('incident', [
        'incident' => $incident->load('camera'),
        'deliveries' => DB::table('notification_deliveries')->where('incident_id', $incident->id)->get(),
    ]))->name('dashboard.incident');
    Route::post('/incidents/{incident}/review', function (Request $request, Incident $incident) {
        $data = $request->validate(['status' => 'required|in:confirmed,dismissed', 'note' => 'nullable|string|max:2000']);
        $incident->update(['status' => $data['status'], 'review_note' => $data['note'] ?? null,
            'reviewed_by' => Auth::id(), 'reviewed_at' => now(), 'resolved_at' => now()]);
        if ($incident->type === 'label_needs_review' && !empty($incident->metadata['label_id'])) {
            $label = LabelRecord::find($incident->metadata['label_id']);
            if ($label) {
                if ($data['status'] === 'confirmed') {
                    $label->update([
                        'review_status' => 'confirmed',
                        'reviewed_by' => Auth::id(),
                        'reviewed_at' => now(),
                        'review_note' => $data['note'] ?? null,
                    ]);
                    app(\App\Services\SlmMatcher::class)->match($label);
                } elseif ($data['status'] === 'dismissed') {
                    $label->update([
                        'review_status' => 'rejected',
                        'reviewed_by' => Auth::id(),
                        'reviewed_at' => now(),
                        'review_note' => $data['note'] ?? null,
                    ]);
                }
            }
        }
        return back();
    });

    Route::post('/notification-rules', function (Request $request) {
        $data = $request->validate([
            'incident_type' => 'required|in:anomaly,camera_offline,worker_offline,person_absent',
            'channel' => 'required|in:push,whatsapp', 'enabled' => 'required|boolean',
            'whatsapp_number' => 'required_if:channel,whatsapp|nullable|regex:/^\+[1-9][0-9]{7,14}$/',
            'user_id' => 'nullable|exists:users,id',
        ]);
        $recipient = $request->user()->is_admin ? ($data['user_id'] ?? Auth::id()) : Auth::id();
        DB::table('notification_rules')->updateOrInsert([
            'user_id' => $recipient, 'incident_type' => $data['incident_type'], 'channel' => $data['channel'],
        ], ['enabled' => $data['enabled'], 'whatsapp_number' => $data['whatsapp_number'] ?? null,
            'created_at' => now(), 'updated_at' => now()]);
        return back();
    });

    Route::get('/evidence/{kind}/{id}', [\App\Http\Controllers\Api\CctvController::class, 'evidence'])
        ->name('dashboard.evidence');
});

Route::middleware('stream.auth')->group(function () {
    Route::get('/cameras/{camera}/live/{file}', [\App\Http\Controllers\Api\PresenceController::class, 'video']);
    Route::get('/cameras/{camera}/realtime', [\App\Http\Controllers\Api\PresenceController::class, 'realtime']);
    Route::get('/cameras/{camera}/live-frame', [\App\Http\Controllers\Api\PresenceController::class, 'live']);
    Route::get('/cameras/{camera}/stream', [\App\Http\Controllers\Api\PresenceController::class, 'stream']);
});

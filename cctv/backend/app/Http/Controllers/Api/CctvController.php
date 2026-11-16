<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Camera;
use App\Models\Incident;
use App\Models\LabelRecord;
use App\Services\SlmMatcher;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;

class CctvController extends Controller
{
    public function cameras()
    {
        return Camera::orderBy('name')->get()->each(function ($camera) {
            $camera->setAttribute('live_video_available', Storage::disk('local')->exists("cctv/live-video/{$camera->id}/stream.m3u8"));
        });
    }

    public function createCamera(Request $request)
    {
        abort_unless($request->user()->is_admin, 403);
        $data = $request->validate([
            'name' => 'required|string|max:100', 'location' => 'nullable|string|max:100',
            'stream_env_key' => ['required', 'regex:/^CCTV_CAMERA_[0-9]+_URL$/', 'unique:cameras,stream_env_key'],
        ]);
        return response()->json(Camera::create($data), 201);
    }

    public function zones(Request $request, Camera $camera)
    {
        abort_unless($request->user()->is_admin, 403);
        $data = $request->validate([
            'zones' => 'required|array|min:1|max:20',
            'zones.*.type' => ['required', Rule::in(['store_boundary', 'box_area', 'packing_route', 'danger_zone', 'packing_area'])],
            'zones.*.points' => 'required|array|min:3|max:30',
            'zones.*.points.*' => 'required|array|size:2',
            'zones.*.points.*.0' => 'required|numeric|between:0,1',
            'zones.*.points.*.1' => 'required|numeric|between:0,1',
        ]);
        $types = array_count_values(array_column($data['zones'], 'type'));
        if (max($types) > 1) {
            return response()->json(['message' => 'Setiap jenis zona hanya boleh digambar sekali.'], 422);
        }
        $camera->update(['zones' => $data['zones'], 'zones_approved_at' => null, 'zones_approved_by' => null]);
        return $camera;
    }

    public function uploadReference(Request $request, Camera $camera)
    {
        abort_unless($request->user()->is_admin, 403);
        $request->validate(['image' => 'required|image|max:4096']);
        if ($camera->reference_path) {
            Storage::disk('local')->delete($camera->reference_path);
        }
        $camera->update(['reference_path' => $request->file('image')->store('cctv/references', 'local'),
            'zones_approved_at' => null, 'zones_approved_by' => null]);
        return $camera;
    }

    public function approveZones(Request $request, Camera $camera)
    {
        abort_unless($request->user()->is_admin, 403);
        $types = array_column($camera->zones ?? [], 'type');
        foreach (['store_boundary', 'box_area', 'packing_route'] as $required) {
            if (!$camera->reference_path || !in_array($required, $types, true)) {
                return response()->json(['message' => 'Frame dan tiga zona wajib diperiksa sebelum disetujui.'], 422);
            }
        }
        $camera->update(['zones_approved_at' => now(), 'zones_approved_by' => $request->user()->id]);
        return $camera;
    }

    public function labels()
    {
        return LabelRecord::with('camera:id,name,location')->latest('first_seen_at')->paginate(30);
    }

    public function label(LabelRecord $label)
    {
        return $label->load('camera:id,name,location');
    }

    public function reviewLabel(Request $request, LabelRecord $label, SlmMatcher $matcher)
    {
        $data = $request->validate([
            'status' => 'required|in:confirmed,rejected', 'field_one' => 'required_if:status,confirmed|nullable|string|max:100',
            'field_two' => 'required_if:status,confirmed|nullable|string|max:150',
            'field_three' => 'required_if:status,confirmed|nullable|string|max:100',
            'note' => 'nullable|string|max:2000',
        ]);
        $update = ['review_status' => $data['status'], 'reviewed_by' => $request->user()->id,
            'reviewed_at' => now(), 'review_note' => $data['note'] ?? null];
        if ($data['status'] === 'confirmed') {
            $update += ['field_one' => trim($data['field_one']),
                'field_two' => trim($data['field_two'] ?? '') ?: null,
                'field_three' => trim($data['field_three'] ?? '') ?: null];
        }
        if ($label->packing_completed_at) {
            abort_if($data['status'] !== 'confirmed' || collect(['field_one','field_two','field_three'])->contains(fn ($field) => ($update[$field] ?? null) !== $label->$field), 422,
                'Invoice packing yang sudah dikonfirmasi tidak dapat diubah.');
        }
        $label->update($update);
        if ($data['status'] === 'confirmed') {
            Incident::where('type', 'label_needs_review')
                ->where('metadata->label_id', $label->id)
                ->whereNull('resolved_at')
                ->update([
                    'status' => 'confirmed',
                    'resolved_at' => now(),
                    'reviewed_by' => $request->user()->id,
                    'reviewed_at' => now(),
                    'review_note' => $data['note'] ?? 'Disetujui manual oleh operator.',
                ]);
            $matcher->match($label);
        } elseif ($data['status'] === 'rejected') {
            Incident::where('type', 'label_needs_review')
                ->where('metadata->label_id', $label->id)
                ->whereNull('resolved_at')
                ->update([
                    'status' => 'dismissed',
                    'resolved_at' => now(),
                    'reviewed_by' => $request->user()->id,
                    'reviewed_at' => now(),
                    'review_note' => $data['note'] ?? 'Ditolak manual oleh operator.',
                ]);
        }
        return $label;
    }

    public function incidents(Request $request)
    {
        return Incident::with('camera:id,name,location')->when($request->query('status'),
            fn ($q, $status) => $q->where('status', $status))->latest('occurred_at')->paginate(30);
    }

    public function incident(Incident $incident)
    {
        return $incident->load('camera:id,name,location');
    }

    public function review(Request $request, Incident $incident)
    {
        $data = $request->validate(['status' => 'required|in:confirmed,dismissed', 'note' => 'nullable|string|max:2000']);
        $incident->update(['status' => $data['status'], 'review_note' => $data['note'] ?? null,
            'reviewed_by' => $request->user()->id, 'reviewed_at' => now()]);
        return $incident;
    }

    public function rules(Request $request)
    {
        if ($request->isMethod('get')) {
            return DB::table('notification_rules')->where('user_id', $request->user()->id)->get();
        }
        $data = $request->validate([
            'incident_type' => 'required|in:anomaly,camera_offline,worker_offline,person_absent',
            'channel' => 'required|in:push,whatsapp,email', 'enabled' => 'required|boolean',
            'whatsapp_number' => 'required_if:channel,whatsapp|nullable|regex:/^\+[1-9][0-9]{7,14}$/',
            'user_id' => 'nullable|exists:users,id',
        ]);
        $recipient = $request->user()->is_admin ? ($data['user_id'] ?? $request->user()->id) : $request->user()->id;
        DB::table('notification_rules')->updateOrInsert([
            'user_id' => $recipient, 'incident_type' => $data['incident_type'],
            'channel' => $data['channel'],
        ], ['enabled' => $data['enabled'], 'whatsapp_number' => $data['whatsapp_number'] ?? null,
            'created_at' => now(), 'updated_at' => now()]);
        return response()->json(['saved' => true]);
    }

    public function evidence(Request $request, string $kind, int $id, array $headers = [])
    {
        if (!in_array($kind, ['incident-clip', 'incident-snapshot', 'label-snapshot', 'camera-reference'], true)) {
            abort(404);
        }
        $record = match ($kind) {
            'label-snapshot' => LabelRecord::findOrFail($id),
            'camera-reference' => Camera::findOrFail($id),
            default => Incident::findOrFail($id),
        };
        $path = match ($kind) {
            'incident-clip' => $record->clip_path,
            'incident-snapshot' => $record->snapshot_path,
            'label-snapshot' => $record->evidence_path,
            'camera-reference' => $record->reference_path,
        };
        if (!$path || !str_starts_with($path, 'cctv/') || str_contains($path, '..')
            || !Storage::disk('local')->exists($path)) {
            abort(404);
        }
        return response()->file(Storage::disk('local')->path($path), array_merge([
            'Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff',
        ], $headers));
    }
}

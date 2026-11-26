<?php
namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Camera;
use App\Models\PresenceTrack;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class PresenceController extends Controller
{
    public function ingest(Request $request, Camera $camera)
    {
        $data = $request->validate([
            'session_id'=>'required|string|max:64|regex:/^[a-zA-Z0-9-]+$/',
            'detector_ready'=>'required|boolean', 'tracks'=>'required|json', 'objects'=>'nullable|json',
            'snapshot'=>'required|image|max:4096',
        ]);
        $tracks = json_decode($data['tracks'], true);
        validator(['tracks'=>$tracks], [
            'tracks'=>'array|max:50', 'tracks.*.id'=>'required|string|max:64|regex:/^[a-zA-Z0-9-]+$/',
            'tracks.*.box'=>'required|array|size:4', 'tracks.*.box.*'=>'numeric|between:0,1',
        ])->validate();
        $objects=json_decode($data['objects'] ?? '[]', true);
        validator(['objects'=>$objects], ['objects'=>'array|max:50',
            'objects.*.id'=>'required|string|max:64|regex:/^[a-zA-Z0-9-]+$/',
            'objects.*.box'=>'required|array|size:4', 'objects.*.box.*'=>'numeric|between:0,1'])->validate();
        abort_if(!$data['detector_ready'] && (count($tracks) || count($objects)), 422);
        $photo = $request->file('snapshot')->get();
        $old = $camera->live_path;
        $live = $request->file('snapshot')->store('cctv/live', 'local');
        $camera->update(['live_path'=>$live, 'frame_at'=>now(), 'tracking_session'=>$data['session_id'],
            'detector_ready'=>$data['detector_ready'], 'object_tracks'=>$objects]);
        if ($old) Storage::disk('local')->delete($old);
        $now = now();
        $known = PresenceTrack::where('camera_id',$camera->id)->where('session_id',$data['session_id'])
            ->whereIn('track_id', array_column($tracks,'id'))->get()->keyBy('track_id');
        foreach ($tracks as $item) {
            $track = $known[$item['id']] ?? PresenceTrack::create([
                'camera_id'=>$camera->id, 'session_id'=>$data['session_id'], 'track_id'=>$item['id'],
                'first_seen_at'=>$now, 'last_seen_at'=>$now,
            ]);
            $update = ['last_seen_at'=>$now, 'box'=>$item['box'], 'absence_alerted_at'=>null];
            // Gambar penuh hanya untuk orang yang baru terlihat atau tiap menit; bukan tiap observasi per orang.
            $disk = Storage::disk('local');
            if (!$track->snapshot_path || !$disk->exists($track->snapshot_path)
                || $disk->lastModified($track->snapshot_path) < $now->copy()->subMinute()->timestamp) {
                $path = "cctv/presence/{$track->id}.jpg";
                $disk->put($path, $photo);
                $update['snapshot_path'] = $path;
            }
            $track->update($update);
        }
        return response()->json(['saved'=>true]);
    }
    public function reports(Request $request)
    {
        $data=$request->validate(['camera_id'=>'nullable|integer', 'classification'=>'nullable|in:customer,staff,visitor,unclassified',
            'from'=>'nullable|date', 'to'=>'nullable|date|after_or_equal:from']);
        return PresenceTrack::with('camera:id,name,location')
            ->when($data['camera_id'] ?? null, fn ($q,$id)=>$q->where('camera_id',$id))
            ->when($data['classification'] ?? null, fn ($q,$value)=>$q->where('classification',$value))
            ->when($data['from'] ?? null, fn ($q,$value)=>$q->where('last_seen_at','>=',$value))
            ->when($data['to'] ?? null, fn ($q,$value)=>$q->where('first_seen_at','<=',$value))
            ->latest('last_seen_at')->paginate(30);
    }
    public function classify(Request $request, PresenceTrack $track)
    {
        abort_unless($request->user()->is_admin,403);
        $data=$request->validate(['classification'=>'required|in:customer,staff,visitor,unclassified']);
        $track->update($data);
        return $track;
    }
    public function settings(Request $request, Camera $camera)
    {
        abort_unless($request->user()->is_admin,403);
        $data=$request->validate(['absence_seconds'=>'required|integer|between:60,86400',
            'presence_alerts_enabled'=>'required|boolean']);
        $camera->update($data);
        return $camera;
    }
    /**
     * Live realtime: MP4 bertahap dari relay go2rtc (CCTV_REALTIME_RELAY=true, di belakang proxy nginx stack).
     * Nginx menerima X-Accel-Redirect dan mengalirkan video langsung; PHP tidak ikut menahan sambungan.
     * Tanpa relay: 404, pemutar memakai HLS.
     */
    public function realtime(Request $request, Camera $camera)
    {
        abort_unless(config('cctv.realtime_relay'), 404);
        $key = (string) ($camera->stream_env_key ?: 'CCTV_CAMERA_'.$camera->id.'_URL');
        $url = (string) (getenv($key) ?: ($_ENV[$key] ?? ''));
        abort_unless(preg_match('#/Streaming/Channels/([0-9]+)0[1-9](?:[?].*)?$#', $url, $m), 404);
        // ?codec=h264: sub-stream diubah ke H.264 oleh go2rtc untuk browser yang tidak bisa memutar H.265.
        $stream = $request->query('codec') === 'h264'
            ? 'ch'.$m[1].'02h264'
            : 'ch'.$m[1].(config('cctv.realtime_substream') ? '02' : '01');
        return response('', 200, [
            'X-Accel-Redirect' => '/_go2rtc/api/stream.mp4?src='.$stream,
            'Cache-Control' => 'private, no-store',
        ]);
    }

    public function video(Camera $camera, string $file)
    {
        abort_unless(preg_match('/^(stream\.m3u8|segment[0-9]+\.ts)$/', $file), 404);
        // Penanda penonton: worker vision hanya menyalakan encoder live selama penanda ini baru,
        // jadi DVR toko tidak mengirim video 24 jam bila tidak ada yang menonton.
        $this->markViewer($camera);
        $retry = ['Retry-After' => '2', 'Cache-Control' => 'no-store'];
        abort_unless($camera->frame_at && $camera->frame_at->greaterThan(now()->subSeconds(20)), 503, '', $retry);
        $path = "cctv/live-video/{$camera->id}/{$file}";
        $playlist = "cctv/live-video/{$camera->id}/stream.m3u8";
        // Encoder baru dinyalakan saat penonton datang: playlist belum ada = coba lagi sebentar.
        abort_unless(Storage::disk('local')->exists($path), $file === 'stream.m3u8' ? 503 : 404, '', $retry);
        // A healthy AI worker does not prove its separate live encoder is healthy.
        abort_unless(Storage::disk('local')->exists($playlist)
            && Storage::disk('local')->lastModified($playlist) >= now()->subSeconds(20)->timestamp, 503, '', $retry);
        if (config('cctv.x_accel_redirect')) {
            return response('', 200, [
                'X-Accel-Redirect' => "/protected-live-video/{$camera->id}/{$file}",
                'Cache-Control' => 'private, no-store',
                'X-Content-Type-Options' => 'nosniff',
                'Access-Control-Allow-Origin' => '*',
                'Content-Type' => str_ends_with($file, '.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
            ]);
        }
        return response()->file(Storage::disk('local')->path($path), [
            'Cache-Control'=>'private, no-store', 'X-Content-Type-Options'=>'nosniff',
            'Access-Control-Allow-Origin' => '*',
            'Content-Type'=>str_ends_with($file,'.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
        ]);
    }
    private function markViewer(Camera $camera): void
    {
        $directory = Storage::disk('local')->path("cctv/live-video/{$camera->id}");
        if (!is_dir($directory)) {
            @mkdir($directory, 0775, true);
        }
        @touch($directory.'/.viewer');
    }

    public function stream(Camera $camera)
    {
        return $this->live($camera);
    }
    public function live(Camera $camera)
    {
        abort_unless($camera->live_path && Storage::disk('local')->exists($camera->live_path),404);
        return response()->file(Storage::disk('local')->path($camera->live_path),[
            'Cache-Control'=>'private, no-store', 'X-Frame-Time'=>$camera->frame_at?->toIso8601String(),
            'X-Content-Type-Options'=>'nosniff',
            'Access-Control-Allow-Origin' => '*',
        ]);
    }
}

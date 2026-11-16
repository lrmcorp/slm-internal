<?php
namespace App\Services;
use App\Models\Camera;
use App\Models\Incident;
use App\Models\PresenceTrack;
use Illuminate\Support\Facades\Storage;

class PresenceMonitor
{
    /** Satu kamera tidak mengirim lebih dari satu peringatan "tidak terlihat" per jendela ini. */
    public const COOLDOWN_MINUTES = 10;

    public function check(IncidentNotifier $notifier): void
    {
        foreach (Camera::where('presence_alerts_enabled',true)->where('detector_ready',true)
            ->where('status','online')->where('last_seen_at','>=',now()->subSeconds(60))
            ->where('frame_at','>=',now()->subSeconds(20))->get() as $camera) {
            $tracks = PresenceTrack::where('camera_id',$camera->id)->where('session_id',$camera->tracking_session)
                ->whereNull('absence_alerted_at')->where('last_seen_at','<=',now()->subSeconds($camera->absence_seconds))
                ->orderBy('last_seen_at')->get();
            if ($tracks->isEmpty()) continue;
            // ID pelacak sering berganti; puluhan ID "hilang" sekaligus harus jadi paling banyak satu peringatan.
            $track = $tracks->first();
            $recent = Incident::where('camera_id',$camera->id)->where('type','person_absent')
                ->where('occurred_at','>=',now()->subMinutes(self::COOLDOWN_MINUTES))->exists();
            PresenceTrack::whereKey($tracks->pluck('id'))->update(['absence_alerted_at'=>now()]);
            if ($recent) continue;
            $key=hash('sha256', 'absence:'.$track->id.':'.$track->last_seen_at->toIso8601String());
            $path="cctv/incidents/absence-{$key}.jpg";
            if ($track->snapshot_path && Storage::disk('local')->exists($track->snapshot_path)) {
                Storage::disk('local')->copy($track->snapshot_path,$path);
            } else { $path=null; }
            $others = $tracks->count() - 1;
            $incident=Incident::firstOrCreate(['dedupe_key'=>$key],[
                'camera_id'=>$camera->id, 'type'=>'person_absent', 'status'=>'needs_review',
                'occurred_at'=>now(), 'snapshot_path'=>$path,
                'reason'=>"Track anonim {$track->track_id} tidak terlihat selama sedikitnya {$camera->absence_seconds} detik"
                    .($others > 0 ? " (dan {$others} track lain)" : '')
                    .". Dapat disebabkan keluar pandangan, tertutup, atau ID pelacak berubah; perlu diperiksa.",
                'metadata'=>['presence_track_id'=>$track->id,'last_seen_at'=>$track->last_seen_at->toIso8601String(),
                    'threshold_seconds'=>$camera->absence_seconds,'classification'=>$track->classification,
                    'other_tracks'=>$others],
            ]);
            if ($incident->wasRecentlyCreated) $notifier->queue($incident);
        }
    }
}

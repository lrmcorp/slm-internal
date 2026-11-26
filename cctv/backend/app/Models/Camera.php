<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Camera extends Model
{
    protected $guarded = ['id'];

    public const DEFAULT_FULL_FRAME_ZONES = [
        [
            'type' => 'store_boundary',
            'points' => [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        ],
        [
            'type' => 'packing_route',
            'points' => [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        ],
        [
            'type' => 'box_area',
            'points' => [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        ],
    ];

    protected static function booted(): void
    {
        static::creating(function (Camera $camera) {
            if (config('cctv.auto_full_frame_zones', true) && empty($camera->zones)) {
                $camera->zones = self::DEFAULT_FULL_FRAME_ZONES;
                if ($camera->zones_approved_at === null) {
                    $camera->zones_approved_at = now();
                }
                if ($camera->status === 'unconfigured' || empty($camera->status)) {
                    $camera->status = 'active';
                }
            }
        });
    }

    protected function casts(): array
    {
        return ['object_tracks' => 'array', 'zones' => 'array', 'zones_approved_at' => 'datetime', 'last_seen_at' => 'datetime', 'status_changed_at' => 'datetime', 'frame_at' => 'datetime',
            'presence_alerts_enabled' => 'boolean', 'detector_ready' => 'boolean',
            'guard_enabled' => 'boolean', 'guard_days' => 'array', 'speaker_enabled' => 'boolean'];
    }

    public function applyFullFrameZones(bool $autoApprove = true): self
    {
        // Area terlarang tetap dipertahankan; full-frame hanya mengganti zona deteksi paket.
        $restricted = array_values(array_filter((array) $this->zones, fn ($zone) => ($zone['type'] ?? null) === 'restricted_zone'));
        $this->zones = array_merge(self::DEFAULT_FULL_FRAME_ZONES, $restricted);
        if ($autoApprove) {
            $this->zones_approved_at = now();
            $this->status = 'active';
        }
        $this->save();

        return $this;
    }
}

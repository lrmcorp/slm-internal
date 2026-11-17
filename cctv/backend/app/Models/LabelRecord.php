<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LabelRecord extends Model
{
    /** Nomor invoice SLM (171126-05) atau invoice MJ (MJ-20261117-0005). */
    public const INVOICE_PATTERN = '/^(?:MJ-\d{8}-\d{4}|\d{6}-\d{2})$/';

    protected $table = 'labels';
    protected $guarded = ['id'];

    protected $appends = ['detected_at'];

    protected function casts(): array
    {
        return ['first_seen_at' => 'datetime', 'last_seen_at' => 'datetime',
            'slm_response' => 'array', 'ai_suggestion' => 'array', 'reviewed_at' => 'datetime',
            'slm_synced_at' => 'datetime', 'packing_completed_at' => 'datetime',
            'created_at' => 'datetime', 'updated_at' => 'datetime'];
    }

    public function getDetectedAtAttribute(): ?\Carbon\Carbon
    {
        return $this->first_seen_at ?? $this->created_at;
    }

    public function camera()
    {
        return $this->belongsTo(Camera::class);
    }
}

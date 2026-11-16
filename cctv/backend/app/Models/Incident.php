<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Incident extends Model
{
    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['occurred_at' => 'datetime', 'reviewed_at' => 'datetime', 'metadata' => 'array'];
    }

    public function camera()
    {
        return $this->belongsTo(Camera::class);
    }
}

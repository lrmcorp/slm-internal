<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
class PresenceTrack extends Model
{
    protected $guarded = ['id'];
    protected function casts(): array
    {
        return ['first_seen_at'=>'datetime', 'last_seen_at'=>'datetime', 'absence_alerted_at'=>'datetime', 'box'=>'array'];
    }
    public function camera() { return $this->belongsTo(Camera::class); }
}

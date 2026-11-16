<?php

namespace App\Services;

use App\Jobs\SendIncidentNotification;
use App\Models\Incident;
use Illuminate\Support\Facades\DB;

class IncidentNotifier
{
    public function queue(Incident $incident): void
    {
        $rules = DB::table('notification_rules')->where('incident_type', $incident->type)
            ->where('enabled', true)->get();
        foreach ($rules as $rule) {
            DB::table('notification_deliveries')->insertOrIgnore([
                'incident_id' => $incident->id,
                'user_id' => $rule->user_id,
                'channel' => $rule->channel,
                'status' => 'pending', 'created_at' => now(), 'updated_at' => now(),
            ]);
            $delivery = DB::table('notification_deliveries')->where('incident_id', $incident->id)
                ->where('user_id', $rule->user_id)->where('channel', $rule->channel)->first();
            if ($delivery->status === 'pending') {
                SendIncidentNotification::dispatch($delivery->id)->onQueue('alerts');
            }
        }

        app(SlmWebhookDispatcher::class)->dispatchIncident($incident);
    }
}

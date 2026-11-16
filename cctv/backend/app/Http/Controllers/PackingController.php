<?php
namespace App\Http\Controllers;
use App\Jobs\SyncMatchedLabelToSlm;
use App\Models\LabelRecord;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
class PackingController extends Controller {
    public function complete(Request $request, LabelRecord $label) {
        DB::transaction(function () use ($request, $label) {
            $record = LabelRecord::whereKey($label->id)->lockForUpdate()->firstOrFail();
            abort_unless($record->review_status === 'confirmed', 422,
                'Periksa dan konfirmasi invoice sebelum menandai packing selesai.');
            abort_unless(trim($record->field_one ?? '') && trim($record->field_two ?? '')
                && in_array(strtoupper(trim($record->field_three ?? '')), ['ANEKA JAYA','MJ'], true), 422,
                'Lengkapi invoice, customer, dan sumber Aneka Jaya/MJ terlebih dahulu.');
            if ($record->packing_completed_at) return;
            $record->update(['packing_completed_at' => $record->detected_at ?? $record->first_seen_at ?? $record->created_at ?? now(), 'packing_completed_by' => $request->user()->id]);
            app(\App\Services\SlmWebhookDispatcher::class)->dispatchPackingCompleted($record);
            if ($record->slm_status === 'matched') {
                $record->update(['slm_sync_status'=>'queued', 'slm_sync_error'=>null]);
                SyncMatchedLabelToSlm::dispatch($record->id)->afterCommit();
            }
        });
        return $request->expectsJson() ? response()->json($label->fresh()) : back();
    }

    public function sync(Request $request, LabelRecord $label) {
        $record = DB::transaction(function () use ($label) {
            $record = LabelRecord::whereKey($label->id)->lockForUpdate()->firstOrFail();
            abort_unless($record->slm_status === 'matched', 422,
                'Invoice belum cocok dengan data SLM. Pastikan nomor invoice valid.');
            abort_unless(in_array($record->review_status, ['confirmed', 'auto_read', 'auto_verified'], true), 422,
                'Periksa dan konfirmasi invoice terlebih dahulu sebelum menyinkronkan.');

            $record->update(['slm_sync_status' => 'queued', 'slm_sync_error' => null]);
            SyncMatchedLabelToSlm::dispatch($record->id)->afterCommit();
            return $record;
        });

        return $request->expectsJson() ? response()->json($record->fresh()) : back();
    }

    public function syncAll(Request $request) {
        $count = 0;
        LabelRecord::where('slm_status', 'matched')
            ->whereIn('review_status', ['confirmed', 'auto_read', 'auto_verified'])
            ->whereIn('slm_sync_status', ['not_ready', 'pending_configuration', 'error'])
            ->chunkById(100, function ($labels) use (&$count) {
                foreach ($labels as $label) {
                    $label->update(['slm_sync_status' => 'queued', 'slm_sync_error' => null]);
                    SyncMatchedLabelToSlm::dispatch($label->id);
                    $count++;
                }
            });

        $pendingReview = LabelRecord::whereIn('review_status', ['pending', 'needs_review'])->count();
        $alreadySynced = LabelRecord::where('slm_sync_status', 'synced')->count();

        $message = $count > 0
            ? "{$count} invoice berhasil dimasukkan ke antrean sinkronisasi ERP."
            : "Tidak ada invoice yang perlu disinkronkan (" .
              ($pendingReview > 0 ? "{$pendingReview} invoice menunggu konfirmasi/review, " : "") .
              ($alreadySynced > 0 ? "{$alreadySynced} invoice sudah tersimpan di ERP" : "belum ada invoice yang cocok") .
              ").";

        return $request->expectsJson()
            ? response()->json([
                'queued_count' => $count,
                'pending_review' => $pendingReview,
                'already_synced' => $alreadySynced,
                'message' => $message,
            ])
            : back()->with('status', $message);
    }
}

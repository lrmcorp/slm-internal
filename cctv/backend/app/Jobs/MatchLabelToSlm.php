<?php
namespace App\Jobs;
use App\Models\LabelRecord;
use App\Services\SlmMatcher;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Foundation\Queue\Queueable;
class MatchLabelToSlm implements ShouldQueue, ShouldBeUnique {
    use Queueable;
    public int $uniqueFor = 120;
    public int $tries = 3;
    public function __construct(public int $labelId, public int $dwellSeconds = 0) {}
    public function uniqueId(): string { return (string) $this->labelId; }
    public function handle(SlmMatcher $matcher): void {
        $label=LabelRecord::find($this->labelId);
        if ($label && (in_array($label->review_status, ['confirmed','auto_read','auto_verified'], true) || config('cctv.auto_sync_packing'))) {
            $matcher->match($label, $this->dwellSeconds);
        }
    }
}

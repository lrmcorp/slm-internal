<?php

namespace Tests;

use App\Jobs\MatchLabelToSlm;
use App\Models\LabelRecord;
use App\Services\SlmMatcher;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /** Pencocokan ERP berjalan di antrean; tes dengan Queue::fake() menjalankannya manual. */
    protected function runMatchJob(LabelRecord $label, int $dwell = 0): LabelRecord
    {
        (new MatchLabelToSlm($label->id, $dwell))->handle(app(SlmMatcher::class));
        return $label->fresh();
    }
}

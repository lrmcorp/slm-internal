<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Support\Facades\Storage;

class IncidentAlert extends Mailable
{
    public function __construct(public string $alertTitle, public string $summary,
        public string $detailUrl, public ?string $snapshotPath = null) {}

    public function build(): static
    {
        return $this->subject($this->alertTitle)->view('mail.incident');
    }

    public function attachments(): array
    {
        $disk = Storage::disk('local');
        if (!$this->snapshotPath || !$disk->exists($this->snapshotPath) || $disk->size($this->snapshotPath) > 5 * 1024 * 1024) {
            return [];
        }
        return [Attachment::fromStorageDisk('local', $this->snapshotPath)->as('bukti-kejadian.jpg')->withMime('image/jpeg')];
    }
}

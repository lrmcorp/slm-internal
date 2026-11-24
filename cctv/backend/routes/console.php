<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use App\Models\User;
use App\Models\Camera;
use App\Models\Incident;
use App\Models\LabelRecord;
use App\Models\PresenceTrack;
use App\Jobs\SyncMatchedLabelToSlm;
use App\Services\IncidentNotifier;
use Illuminate\Support\Facades\Schedule;
use Illuminate\Support\Facades\Storage;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('cctv:register-camera {channel}', function (string $channel) {
    if (!ctype_digit($channel) || (int) $channel < 1 || (int) $channel > 16) {
        $this->error('Pilih kanal DVR dari 1 sampai 16.');
        return 1;
    }
    $camera = Camera::firstOrCreate(['stream_env_key' => "CCTV_CAMERA_{$channel}_URL"], [
        'name' => "Camera {$channel}",
        'location' => $channel === '14' ? 'Pembacaan label' : 'Pemeriksaan dugaan anomali',
    ]);
    $this->line((string) $camera->id);
    return 0;
})->purpose('Daftarkan kamera tanpa menyetujui zona atau mengubah kamera yang sudah ada');

Artisan::command('cctv:create-admin {email} {--show-password}', function (string $email) {
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $this->error('Email tidak valid.');
        return 1;
    }
    $password = $this->option('show-password')
        ? $this->ask('Kata sandi terlihat (minimal 12 karakter; jangan bagikan foto terminal)')
        : $this->secret('Kata sandi (minimal 12 karakter)');
    if (strlen($password ?? '') < 12) {
        $this->error('Kata sandi terlalu pendek.');
        return 1;
    }
    User::updateOrCreate(['email' => $email], ['name' => strtok($email, '@'),
        'password' => $password, 'is_admin' => true]);
    $this->info('Pengguna siap.');
    return 0;
})->purpose('Buat pengguna dashboard tanpa menyimpan kata sandi di shell history');

Artisan::command('cctv:create-user {email}', function (string $email) {
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $this->error('Email tidak valid.');
        return 1;
    }
    $password = $this->secret('Kata sandi (minimal 12 karakter)');
    if (strlen($password ?? '') < 12) {
        $this->error('Kata sandi terlalu pendek.');
        return 1;
    }
    User::updateOrCreate(['email' => $email], ['name' => strtok($email, '@'), 'password' => $password]);
    $this->info('Penerima siap.');
    return 0;
})->purpose('Buat penerima notifikasi tanpa menyimpan kata sandi di shell history');

Artisan::command('cctv:check-health', function (IncidentNotifier $notifier) {
    foreach (Camera::whereNotNull('last_seen_at')->get() as $camera) {
        $type = $camera->last_seen_at->lt(now()->subSeconds(60)) ? 'worker_offline'
            : ($camera->status === 'online' ? null : 'camera_offline');
        if (!$type || Incident::where('camera_id', $camera->id)->where('type', $type)
            ->whereNull('resolved_at')->exists()) {
            continue;
        }
        $incident = Incident::create([
            'camera_id' => $camera->id, 'type' => $type, 'status' => 'needs_review',
            'reason' => $type === 'worker_offline' ? 'Heartbeat proses pemantauan berhenti lebih dari 60 detik.'
                : 'Kamera atau stream tidak dapat dibaca.',
            'occurred_at' => now(), 'dedupe_key' => hash('sha256', $camera->id.':'.$type.':'.now()->timestamp),
        ]);
        $notifier->queue($incident);
    }

    // Pemantauan sisa ruang penyimpanan disk
    $storagePath = storage_path('app');
    $freeBytes = @disk_free_space($storagePath);
    $totalBytes = @disk_total_space($storagePath);
    if ($freeBytes !== false && $totalBytes !== false && $totalBytes > 0) {
        $freePercent = ($freeBytes / $totalBytes) * 100;
        $freeGb = $freeBytes / (1024 * 1024 * 1024);
        $minPercent = (float) config('cctv.min_free_disk_percent', 15.0);
        $minGb = (float) config('cctv.min_free_disk_gb', 2.0);

        if ($freePercent < $minPercent || $freeGb < $minGb) {
            $hourDedupe = 'disk_space_warning:' . date('Y-m-d-H');
            if (!Incident::where('dedupe_key', $hourDedupe)->exists()) {
                $firstCamera = Camera::first();
                if ($firstCamera) {
                    $incident = Incident::create([
                        'camera_id' => $firstCamera->id,
                        'type' => 'disk_space_warning',
                        'status' => 'needs_review',
                        'reason' => sprintf(
                            'Kapasitas disk kritis! Sisa: %.2f GB (%.1f%% dari %.2f GB). Bersihkan storage atau tambah kuota disk.',
                            $freeGb,
                            $freePercent,
                            $totalBytes / (1024 * 1024 * 1024)
                        ),
                        'occurred_at' => now(),
                        'dedupe_key' => $hourDedupe,
                        'metadata' => [
                            'free_bytes' => $freeBytes,
                            'total_bytes' => $totalBytes,
                            'free_gb' => round($freeGb, 2),
                            'free_percent' => round($freePercent, 1),
                        ],
                    ]);
                    $notifier->queue($incident);
                }
            }
        }
    }
})->purpose('Deteksi kamera offline, proses terhenti, dan peringatan dini kapasitas disk');

Artisan::command('cctv:sync-matched-labels', function () {
    if (!str_starts_with(config('cctv.slm_base_url') ?? '', 'https://')
        || !config('cctv.slm_token') || !config('cctv.slm_sync_path')
        || !str_starts_with(config('app.url'), 'https://')) {
        $this->error('Atur URL HTTPS dashboard dan kontrak API sinkronisasi SLM dahulu.');
        return 1;
    }
    $count = 0;
    LabelRecord::where('slm_status', 'matched')
        ->whereIn('slm_sync_status', ['not_ready', 'pending_configuration', 'error'])
        ->chunkById(100, function ($labels) use (&$count) {
            foreach ($labels as $label) {
                $label->update(['slm_sync_status' => 'queued', 'slm_sync_error' => null]);
                SyncMatchedLabelToSlm::dispatch($label->id);
                $count++;
            }
        });
    $this->info("{$count} label cocok masuk antrean sinkronisasi SLM.");
    return 0;
})->purpose('Ulangi pengiriman catatan label yang sudah cocok ke SLM');

Schedule::command('cctv:check-health')->everyMinute()->withoutOverlapping();

Artisan::command('cctv:check-presence', function (\App\Services\PresenceMonitor $monitor, IncidentNotifier $notifier) {
    $monitor->check($notifier);
})->purpose('Periksa track anonim yang tidak terlihat ketika kamera tetap aktif');
Schedule::command('cctv:check-presence')->everyMinute()->withoutOverlapping();

// Pemeriksaan pemasangan speaker: php artisan cctv:speaker-check 1
Artisan::command('cctv:speaker-check {camera}', function (string $camera, \App\Services\CameraSpeaker $speaker) {
    $model = \App\Models\Camera::findOrFail($camera);
    $this->info("Kamera #{$model->id} {$model->name}: variabel ".\App\Services\CameraSpeaker::envKey($model).', kanal '.($model->speaker_channel ?: 1));
    try {
        $body = $speaker->describe($model);
    } catch (\Throwable $e) {
        $this->error($e->getMessage());
        return 1;
    }
    preg_match_all('/<id>(\d+)<\/id>|<audioCompressionType>([^<]+)<\/audioCompressionType>|<enabled>([^<]+)<\/enabled>/', $body, $m);
    $this->line(trim(preg_replace('/\s+/', ' ', strip_tags(str_replace('><', '> <', $body)))));
    $this->info(str_contains(strtolower($body), 'g.711ulaw') ? 'Format G.711ulaw tersedia: cocok dengan suara yang dikirim.' : 'G.711ulaw tidak terlihat: ubah Audio Encoding kamera ke G.711ulaw di pengaturan Audio.');
    return 0;
})->purpose('Periksa two-way audio speaker kamera');

// Putar kalimat di speaker kamera: php artisan cctv:speak 1 "Tes speaker"
Artisan::command('cctv:speak {camera} {text?}', function (string $camera, \App\Services\TextToSpeech $tts, \App\Services\CameraSpeaker $speaker) {
    $model = \App\Models\Camera::findOrFail($camera);
    $sentence = $this->argument('text') ?: \App\Services\GuardSchedule::message($model);
    try {
        $audio = $tts->ulaw($sentence);
        $this->info('Suara Google siap: '.round(strlen($audio) / \App\Services\TextToSpeech::SAMPLE_RATE, 1).' detik.');
        $speaker->play($model, $audio);
    } catch (\Throwable $e) {
        $this->error($e->getMessage());
        return 1;
    }
    $this->info('Terkirim ke speaker kamera #'.$model->id.'.');
    return 0;
})->purpose('Putar kalimat di speaker kamera');

Artisan::command('cctv:auto-sync', function () {
    if (!config('cctv.slm_auto_sync') || !config('cctv.slm_token')
        || !str_starts_with(config('cctv.slm_base_url') ?? '', 'https://') || !config('cctv.slm_sync_path')) return 0;
    LabelRecord::whereIn('review_status', ['auto_read', 'confirmed'])
        ->where(function ($query) {
            $query->whereIn('slm_sync_status', ['not_ready', 'pending_configuration'])
                ->orWhere(function ($query) { $query->where('slm_sync_status', 'error')->where('updated_at', '<=', now()->subMinutes(10)); });
        })->where(function ($query) {
            // Invoice yang ERP bilang tidak ada tidak perlu dicoba tiap 2 menit selamanya; ulangi tiap 1 jam.
            $query->where('slm_status', '!=', 'not_found')->orWhereNull('slm_status')
                ->orWhere('updated_at', '<=', now()->subHour());
        })->orderBy('updated_at')->limit(100)->get()->each(function ($label) {
            if ($label->slm_status === 'matched') {
                if (config('cctv.auto_sync_packing') && !$label->packing_completed_at) {
                    $physicalTime = $label->detected_at ?? $label->first_seen_at ?? $label->created_at ?? now();
                    $label->update(['packing_completed_at' => $physicalTime, 'review_status' => 'auto_read']);
                }
                $label->update(['slm_sync_status'=>'queued', 'slm_sync_error'=>null]);
                SyncMatchedLabelToSlm::dispatch($label->id);
            } else {
                \App\Jobs\MatchLabelToSlm::dispatch($label->id);
            }
        });
    return 0;
})->purpose('Pulihkan pencocokan dan sinkronisasi otomatis setelah konfigurasi atau koneksi ERP tersedia');
Schedule::command('cctv:auto-sync')->everyMinute()->withoutOverlapping();

Artisan::command('cctv:apply-full-frame-zones {--force : Timpa zona kustom yang sudah ada}', function () {
    $force = (bool) $this->option('force');
    $query = Camera::query();
    if (!$force) {
        $query->where(function ($q) {
            $q->whereNull('zones')->orWhereNull('zones_approved_at');
        });
    }

    $cameras = $query->get();
    if ($cameras->isEmpty()) {
        $this->info('Semua kamera sudah memiliki zona aktif yang disetujui.');
        return 0;
    }

    $count = 0;
    foreach ($cameras as $camera) {
        $camera->applyFullFrameZones(true);
        $count++;
        $this->line("Kamera ID {$camera->id} ({$camera->name}) berhasil disetel ke Full-Frame Auto-Zone (Aktif & Disetujui).");
    }

    $this->info("Berhasil mengaktifkan Full-Frame Auto-Zone pada {$count} kamera.");
    return 0;
})->purpose('Setel seluruh kamera ke mode Full-Frame Auto-Zone 100% dan setujui otomatis');

Artisan::command('cctv:repair-label-timestamps {--dry-run : Tampilkan perubahan tanpa menyimpan}', function () {
    $dryRun = (bool) $this->option('dry-run');
    $this->info('Memeriksa kesesuaian packing_completed_at vs waktu deteksi label fisik...');

    $repaired = 0;
    \App\Models\LabelRecord::whereNotNull('packing_completed_at')
        ->chunk(100, function ($labels) use (&$repaired, $dryRun) {
            foreach ($labels as $label) {
                $physicalTime = $label->detected_at ?? $label->first_seen_at ?? $label->created_at;
                if (!$physicalTime) {
                    continue;
                }
                // Jika tidak dikonfirmasi manual oleh operator dan berbeda dengan waktu deteksi fisik asli
                if ($label->packing_completed_by === null && !$label->packing_completed_at->equalTo($physicalTime)) {
                    $this->line("Label #{$label->id} [Invoice {$label->field_one}]: {$label->packing_completed_at->toIso8601String()} -> {$physicalTime->toIso8601String()}");
                    if (!$dryRun) {
                        $label->update(['packing_completed_at' => $physicalTime]);
                    }
                    $repaired++;
                }
            }
        });

    $this->info("Pemeriksaan selesai. Total label diperbaiki: {$repaired}" . ($dryRun ? ' (dry-run mode)' : ''));
    return 0;
})->purpose('Perbaiki packing_completed_at yang keliru terisi now() agar sesuai waktu deteksi fisik asli');

Artisan::command('cctv:prune-storage {--days= : Umur retensi foto bukti label dalam hari} {--incident-days= : Umur retensi insiden dalam hari} {--presence-days= : Umur retensi tracking kehadiran dalam hari} {--dry-run : Tampilkan simulasi file yang akan dihapus tanpa menghapus}', function () {
    $dryRun = (bool) $this->option('dry-run');
    $labelDays = max(1, (int) ($this->option('days') ?: config('cctv.retention_evidence_days', 60)));
    $incidentDays = max(1, (int) ($this->option('incident-days') ?: config('cctv.retention_incident_days', 90)));
    $presenceDays = max(1, (int) ($this->option('presence-days') ?: config('cctv.retention_presence_days', 14)));

    $this->info("Memulai pembersihan berkas penyimpanan CCTV SLM" . ($dryRun ? ' (MODE SIMULASI / DRY-RUN)' : '') . "...");
    $this->line("- Retensi foto bukti label : {$labelDays} hari (hanya yang sudah synced ke ERP)");
    $this->line("- Retensi berkas insiden   : {$incidentDays} hari (hanya yang sudah selesai / resolved)");
    $this->line("- Retensi jejak kehadiran  : {$presenceDays} hari");

    $disk = Storage::disk('local');
    $bytesFreed = 0;

    // 1. Label Evidence (Guardrail: hanya yang slm_sync_status = 'synced' dan review_status != 'needs_review')
    $labelCutoff = now()->subDays($labelDays);
    $prunedLabels = 0;
    LabelRecord::whereNotNull('evidence_path')
        ->where('slm_sync_status', 'synced')
        ->where('review_status', '!=', 'needs_review')
        ->where(function ($q) use ($labelCutoff) {
            $q->where('packing_completed_at', '<', $labelCutoff)
              ->orWhere(function ($sq) use ($labelCutoff) {
                  $sq->whereNull('packing_completed_at')
                     ->where('first_seen_at', '<', $labelCutoff);
              });
        })
        ->chunkById(100, function ($labels) use (&$prunedLabels, &$bytesFreed, $disk, $dryRun) {
            foreach ($labels as $label) {
                $path = $label->evidence_path;
                if ($path && $disk->exists($path)) {
                    $bytesFreed += (int) $disk->size($path);
                    if (!$dryRun) {
                        $disk->delete($path);
                    }
                }
                if (!$dryRun) {
                    $label->update(['evidence_path' => null]);
                }
                $prunedLabels++;
            }
        });

    // 2. Incident Evidence (Guardrail: hanya yang status != 'needs_review' dan resolved_at != null)
    $incidentCutoff = now()->subDays($incidentDays);
    $prunedIncidents = 0;
    Incident::where(function ($q) {
            $q->whereNotNull('snapshot_path')->orWhereNotNull('clip_path');
        })
        ->where('status', '!=', 'needs_review')
        ->whereNotNull('resolved_at')
        ->where('occurred_at', '<', $incidentCutoff)
        ->chunkById(100, function ($incidents) use (&$prunedIncidents, &$bytesFreed, $disk, $dryRun) {
            foreach ($incidents as $incident) {
                if ($incident->snapshot_path && $disk->exists($incident->snapshot_path)) {
                    $bytesFreed += (int) $disk->size($incident->snapshot_path);
                    if (!$dryRun) {
                        $disk->delete($incident->snapshot_path);
                    }
                }
                if ($incident->clip_path && $disk->exists($incident->clip_path)) {
                    $bytesFreed += (int) $disk->size($incident->clip_path);
                    if (!$dryRun) {
                        $disk->delete($incident->clip_path);
                    }
                }
                if (!$dryRun) {
                    $incident->update(['snapshot_path' => null, 'clip_path' => null]);
                }
                $prunedIncidents++;
            }
        });

    // 3. Presence Tracks (Jejak deteksi orang/tamu anonim lama)
    $presenceCutoff = now()->subDays($presenceDays);
    $prunedTracks = 0;
    PresenceTrack::where('last_seen_at', '<', $presenceCutoff)
        ->chunkById(100, function ($tracks) use (&$prunedTracks, &$bytesFreed, $disk, $dryRun) {
            foreach ($tracks as $track) {
                if ($track->snapshot_path && $disk->exists($track->snapshot_path)) {
                    $bytesFreed += (int) $disk->size($track->snapshot_path);
                    if (!$dryRun) {
                        $disk->delete($track->snapshot_path);
                    }
                }
                if (!$dryRun) {
                    $track->delete();
                }
                $prunedTracks++;
            }
        });

    $mbFreed = round($bytesFreed / (1024 * 1024), 2);
    $this->info("Pembersihan selesai!" . ($dryRun ? ' (Simulasi selesai, tidak ada berkas yang dihapus)' : ''));
    $this->table(['Kategori', 'Jumlah Diproses', 'Estimasi Ruang Dibebaskan'], [
        ['Foto Bukti Label Synced', $prunedLabels, "{$prunedLabels} file"],
        ['Berkas Insiden Resolved', $prunedIncidents, "{$prunedIncidents} kejadian"],
        ['Jejak Kehadiran Lama', $prunedTracks, "{$prunedTracks} jejak"],
        ['TOTAL ESTIMASI RUANG', '-', "{$mbFreed} MB ({$bytesFreed} bytes)"],
    ]);

    return 0;
})->purpose('Bersihkan berkas foto bukti lama yang sudah melewati masa retensi untuk mencegah disk penuh');

Schedule::command('cctv:prune-storage')->dailyAt('02:00')->withoutOverlapping();

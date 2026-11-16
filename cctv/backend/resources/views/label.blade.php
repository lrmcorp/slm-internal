@extends('layout')
@section('title', 'Invoice '.$label->field_one)
@section('content')
<nav class="breadcrumb-nav" aria-label="Breadcrumb">
    <a href="{{ route('dashboard', ['section' => 'labels']) }}">
        @include('partials.icon', ['name' => 'label'])
        <span>Daftar Label &amp; Invoice</span>
    </a>
    <span class="separator">›</span>
    <span class="current">Invoice {{ $label->field_one }}</span>
</nav>

<div class="page-heading">
    <div>
        <p class="eyebrow">PEMERIKSAAN BUKTI PACKING</p>
        <h1 style="margin: 4px 0 6px;">Invoice #{{ $label->field_one }}</h1>
        <p>Kamera {{ $label->camera?->name ?? 'Kamera' }} · Tertangkap {{ $label->first_seen_at?->timezone('Asia/Jakarta')->format('d M Y, H:i:s') ?? 'Waktu tidak tersedia' }} WIB</p>
    </div>
    <div class="status-pill-group">
        <span class="badge {{ in_array($label->review_status, ['confirmed', 'auto_verified'], true) ? 'good' : ($label->review_status === 'rejected' ? 'bad' : 'warn') }}">
            Review: {{ ['confirmed' => 'Terkonfirmasi', 'auto_verified' => 'Auto Terverifikasi', 'rejected' => 'Ditolak', 'needs_review' => 'Perlu Review', 'pending' => 'Menunggu Review', 'auto_read' => 'Auto Terbaca'][$label->review_status] ?? $label->review_status }}
        </span>
        <span class="badge {{ $label->packing_completed_at ? 'good' : 'warn' }}">
            Packing: {{ $label->packing_completed_at ? 'Selesai' : 'Belum Selesai' }}
        </span>
        <span class="badge {{ $label->slm_status === 'matched' ? 'good' : ($label->slm_status === 'error' ? 'bad' : 'warn') }}">
            SLM: {{ ['matched' => 'Cocok', 'not_found' => 'Tidak Ditemukan', 'incomplete' => 'Belum Lengkap', 'unavailable' => 'Belum Terhubung', 'error' => 'Gagal'][$label->slm_status] ?? $label->slm_status }}
        </span>
    </div>
</div>

<div class="grid-split">
    <!-- Kolom Kiri: Bukti Visual & Ekstraksi Visi -->
    <section class="card">
        <div class="card-header">
            <div>
                <h2>Bukti Foto &amp; Deteksi Kamera</h2>
                <p>Frame saat barcode/QR label tertangkap kamera meja packing</p>
            </div>
            @if($label->evidence_path)
                <a href="{{ route('dashboard.evidence', ['kind' => 'label-snapshot', 'id' => $label->id]) }}" target="_blank" class="secondary btn-sm" style="font-size: 11.5px; padding: 6px 12px;">
                    Buka Ukuran Asli ↗
                </a>
            @endif
        </div>

        @if($label->evidence_path)
            <div class="evidence-media-card">
                <img alt="Bukti foto label packing" src="{{ route('dashboard.evidence', ['kind' => 'label-snapshot', 'id' => $label->id]) }}">
            </div>
            <div class="evidence-meta-bar">
                <span>Kamera: <strong>{{ $label->camera?->name ?? 'Kamera' }}</strong></span>
                <span>Tingkat Keyakinan: <strong>{{ round($label->confidence * 100) }}%</strong></span>
                <span>Waktu: <strong>{{ $label->first_seen_at?->timezone('Asia/Jakarta')->format('H:i:s') }} WIB</strong></span>
            </div>
        @else
            <div class="empty-state">
                <p>Foto bukti tidak tersedia.</p>
            </div>
        @endif

        <div class="ocr-summary-grid">
            <div class="ocr-chip">
                <div class="ocr-chip-label">Nomor Invoice</div>
                <div class="ocr-chip-val">{{ $label->field_one ?: '-' }}</div>
            </div>
            <div class="ocr-chip">
                <div class="ocr-chip-label">Nama Customer</div>
                <div class="ocr-chip-val">{{ $label->field_two ?: 'Perlu Diperiksa' }}</div>
            </div>
            <div class="ocr-chip">
                <div class="ocr-chip-label">Toko Asal</div>
                <div class="ocr-chip-val">{{ $label->field_three ?: 'Belum Ada' }}</div>
            </div>
        </div>

        @if($label->raw_ocr || $label->ai_suggestion)
            <details class="collapsible-raw">
                <summary>▸ Tampilkan Teks Mentah OCR &amp; Debug Kamera</summary>
                <div class="mt-3">
                    @if($label->raw_ocr)
                        <p class="text-xs text-muted" style="margin-bottom: 4px;"><strong>Hasil Pembacaan Mentah (Raw OCR):</strong></p>
                        <div class="code-block-viewer" style="margin-bottom: 12px; max-height: 140px; overflow-y: auto;">{{ $label->raw_ocr }}</div>
                    @endif
                    @if($label->ai_suggestion)
                        <p class="text-xs text-muted" style="margin-bottom: 4px;"><strong>Saran Verifikasi AI:</strong></p>
                        <div class="code-block-viewer" style="max-height: 140px; overflow-y: auto;">{{ json_encode($label->ai_suggestion, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) }}</div>
                    @endif
                </div>
            </details>
        @endif
    </section>

    <!-- Kolom Kanan: Panel Tindakan & Integrasi ERP Terpadu -->
    <section class="card card-flush">
        <div class="card-header">
            <div>
                <h2>Panel Verifikasi &amp; Integrasi ERP</h2>
                <p>Status sinkronisasi dan tindakan operasional meja packing</p>
            </div>
        </div>

        <!-- Bagian 1: Ringkasan Status Integrasi -->
        <div class="card-section">
            <div class="card-section-title">
                <span>Ringkasan Status Integrasi</span>
            </div>
            <div class="meta-list">
                <div class="meta-row">
                    <span class="meta-label">Status Packing:</span>
                    <span class="meta-value">
                        @if($label->packing_completed_at)
                            <span class="badge good">Selesai Dikonfirmasi</span>
                            <small class="text-muted" style="display: block; margin-top: 2px;">{{ $label->packing_completed_at->timezone('Asia/Jakarta')->format('d M Y H:i:s') }} WIB</small>
                        @else
                            <span class="badge warn">Belum Selesai</span>
                        @endif
                    </span>
                </div>
                <div class="meta-row">
                    <span class="meta-label">Pencocokan SLM:</span>
                    <span class="meta-value">
                        <span class="badge {{ $label->slm_status === 'matched' ? 'good' : ($label->slm_status === 'error' ? 'bad' : 'warn') }}">
                            {{ ['matched' => 'Cocok', 'not_found' => 'Tidak Ditemukan', 'incomplete' => 'Data Belum Lengkap', 'unavailable' => 'Belum Terhubung', 'error' => 'Gagal'][$label->slm_status] ?? $label->slm_status }}
                        </span>
                        @if($label->slm_reference)
                            <small class="text-muted" style="display: block; margin-top: 2px;">Ref: {{ $label->slm_reference }}</small>
                        @endif
                    </span>
                </div>
                <div class="meta-row">
                    <span class="meta-label">Sinkronisasi ERP:</span>
                    <span class="meta-value">
                        <span class="badge {{ $label->slm_sync_status === 'synced' ? 'good' : ($label->slm_sync_status === 'error' ? 'bad' : 'warn') }}">
                            {{ ['synced' => 'ERP Terkirim &amp; Tersimpan', 'queued' => 'Dalam Antrean', 'pending_configuration' => 'Menunggu Integrasi', 'not_ready' => 'Belum Terkirim', 'error' => 'Gagal Kirim', 'missing_photo' => 'Foto Belum Ada'][$label->slm_sync_status] ?? $label->slm_sync_status }}
                        </span>
                        @if($label->slm_synced_at)
                            <small class="text-muted" style="display: block; margin-top: 2px;">{{ $label->slm_synced_at->timezone('Asia/Jakarta')->format('d M Y H:i:s') }} WIB</small>
                        @endif
                    </span>
                </div>
                @if(!empty($label->slm_response['note']))
                    <div class="meta-row" style="align-items: flex-start;">
                        <span class="meta-label">Catatan ERP:</span>
                        <span class="meta-value">
                            <span class="badge warn" style="white-space: normal; text-align: right; display: inline-block; max-width: 220px;">
                                {{ $label->slm_response['note'] }}
                            </span>
                        </span>
                    </div>
                @endif
            </div>
        </div>

        <!-- Bagian 2: Form Validasi & Koreksi Manusia -->
        <form id="label-review-form" method="post" action="/labels/{{ $label->id }}/review">
            @csrf
            <div class="card-section">
                <div class="card-section-title">
                    <span>Koreksi &amp; Validasi Data</span>
                </div>
                <div class="form-group" style="margin-bottom: 12px;">
                    <label for="field_one">Nomor Invoice</label>
                    <input id="field_one" name="field_one" value="{{ old('field_one', $label->field_one) }}" required placeholder="Contoh: 121026-23">
                </div>
                <div class="form-group" style="margin-bottom: 12px;">
                    <label for="field_two">Nama Customer</label>
                    <input id="field_two" name="field_two" value="{{ old('field_two', $label->field_two) }}" required placeholder="Nama penerima/toko">
                </div>
                <div class="form-group" style="margin-bottom: 12px;">
                    <label for="field_three">Toko Asal (Aneka Jaya / MJ)</label>
                    <input id="field_three" name="field_three" value="{{ old('field_three', $label->field_three) }}" required placeholder="Contoh: Aneka Jaya">
                </div>
                <div class="form-group" style="margin-bottom: 0;">
                    <label for="note">Catatan Tambahan (Opsional)</label>
                    <textarea id="note" name="note" rows="2" placeholder="Catatan pemeriksa jika ada ketidaksesuaian...">{{ old('note', $label->review_note) }}</textarea>
                </div>
            </div>

            <!-- Bagian 3: Tombol Aksi Review -->
            <div class="action-bar-footer">
                <div class="btn-group w-full">
                    <button type="submit" name="status" value="confirmed" class="flex-2">
                        Konfirmasi &amp; Cocokkan SLM
                    </button>
                    <button type="submit" name="status" value="rejected" class="danger flex-1">
                        Tolak
                    </button>
                </div>
            </div>
        </form>

        <!-- Aksi Konfirmasi Packing Selesai -->
        @if($label->review_status === 'confirmed' && !$label->packing_completed_at)
            <div class="card-section" style="background: rgba(37, 99, 235, 0.03); border-top: 1px solid var(--border);">
                <form method="post" action="/labels/{{ $label->id }}/packing-complete">
                    @csrf
                    <button type="submit" class="w-full">
                        ✓ Tandai Packing Selesai Sekarang
                    </button>
                </form>
            </div>
        @endif

        <!-- Aksi Sinkronkan ke ERP -->
        @if($label->slm_status === 'matched' && in_array($label->review_status, ['confirmed', 'auto_read', 'auto_verified'], true) && !in_array($label->slm_sync_status, ['synced', 'queued'], true))
            <div class="card-section" style="background: rgba(16, 185, 129, 0.03); border-top: 1px solid var(--border);">
                <form method="post" action="/labels/{{ $label->id }}/sync">
                    @csrf
                    <button type="submit" class="{{ $label->slm_sync_status === 'error' ? 'warn' : 'secondary' }} w-full">
                        {{ $label->slm_sync_status === 'error' ? '🔄 Kirim Ulang ke ERP SLM' : '🚀 Sinkronkan ke ERP SLM Sekarang' }}
                    </button>
                </form>
            </div>
        @endif

        @if($label->reviewed_at)
            <div style="padding: 10px 24px; text-align: center; background: var(--surface-bg); border-top: 1px solid var(--border);">
                <span class="text-xs text-muted">Terakhir diperiksa {{ $label->reviewed_at->timezone('Asia/Jakarta')->format('d M Y H:i') }} WIB</span>
            </div>
        @endif
    </section>
</div>
@endsection

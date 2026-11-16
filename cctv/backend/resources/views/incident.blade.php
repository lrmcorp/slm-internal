@extends('layout')
@section('title', 'Kejadian #'.$incident->id)
@section('content')
<nav class="breadcrumb-nav" aria-label="Breadcrumb">
    <a href="{{ route('dashboard', ['section' => 'incidents']) }}">
        @include('partials.icon', ['name' => 'alert'])
        <span>Daftar Kejadian</span>
    </a>
    <span class="separator">›</span>
    <span class="current">Kejadian #{{ $incident->id }}</span>
</nav>

<div class="page-heading">
    <div>
        <p class="eyebrow">PEMERIKSAAN BUKTI & ANOMALI</p>
        <h1>
            {{ $incident->type === 'anomaly' ? 'Dugaan Anomali Operasional' : ($incident->type === 'person_absent' ? 'Peringatan: Track Tidak Terlihat' : ($incident->type === 'label_needs_review' ? 'Verifikasi Resi/Label Meja Packing' : 'Peringatan: Pemantauan Terhenti')) }}
        </h1>
        <p>Kamera {{ $incident->camera?->name ?? 'Kamera' }} · Waktu kejadian tercatat dalam WIB</p>
    </div>
    <span class="badge {{ $incident->status === 'needs_review' ? 'warn' : ($incident->status === 'confirmed' ? 'bad' : 'good') }}">
        {{ ['needs_review' => 'Perlu Diperiksa', 'confirmed' => 'Telah Ditindaklanjuti', 'dismissed' => 'Peringatan Keliru'][$incident->status] ?? $incident->status }}
    </span>
</div>

<div class="grid-split">
    <!-- Kolom Kiri: Bukti Visual & Rincian -->
    <section class="card">
        <div class="card-header">
            <div>
                <h2>Bukti Kejadian</h2>
                <p>Foto snapshot dan cuplikan video kejadian</p>
            </div>
        </div>

        @if($incident->clip_path)
            <div class="video-viewport-box">
                <video controls preload="metadata" src="{{ route('dashboard.evidence', ['kind' => 'incident-clip', 'id' => $incident->id]) }}"></video>
            </div>
        @elseif($incident->snapshot_path)
            <div class="video-viewport-box">
                <img alt="Bukti kejadian" src="{{ route('dashboard.evidence', ['kind' => 'incident-snapshot', 'id' => $incident->id]) }}">
            </div>
        @else
            <div class="empty-state">
                <p>Media rekaman visual tidak tersedia.</p>
            </div>
        @endif

        <div class="mt-4">
            <h3>Rincian Kejadian</h3>
            <div class="table-wrap">
                <table>
                    <tbody>
                        <tr>
                            <th class="w-third">Waktu Kejadian</th>
                            <td><strong>{{ $incident->occurred_at->timezone('Asia/Jakarta')->format('d M Y H:i:s') }} WIB</strong></td>
                        </tr>
                        <tr>
                            <th>Kamera & Lokasi</th>
                            <td>{{ $incident->camera?->name ?? 'Tidak tersedia' }} · {{ $incident->camera?->location ?? 'Lokasi tidak tersedia' }}</td>
                        </tr>
                        <tr>
                            <th>Alasan Terdeteksi</th>
                            <td>{{ $incident->reason }}</td>
                        </tr>
                        @if($incident->type === 'label_needs_review' && !empty($incident->metadata['label_id']))
                            <tr>
                                <th>Tautan Label</th>
                                <td>
                                    <a href="{{ route('dashboard.label', $incident->metadata['label_id']) }}" class="secondary btn-sm" style="display: inline-block;">
                                        Periksa &amp; Validasi Label #{{ $incident->metadata['field_one'] ?? $incident->metadata['label_id'] }} →
                                    </a>
                                </td>
                            </tr>
                        @else
                            <tr>
                                <th>Perkiraan Jumlah Item</th>
                                <td>{{ $incident->metadata['item_count'] ?? 'Tidak diketahui' }}</td>
                            </tr>
                        @endif
                    </tbody>
                </table>
            </div>
        </div>
    </section>

    <!-- Kolom Kanan: Pemeriksaan Manusia & Notifikasi -->
    <div class="flex flex-col gap-4">
        <section class="card">
            <div class="card-header">
                <div>
                    <h2>Pemeriksaan Manusia</h2>
                    <p>Konfirmasi atau tolak temuan sistem</p>
                </div>
            </div>
            
            <div class="notice">
                <small>Hasil AI adalah deteksi otomatis, bukan tuduhan. Selalu periksa rekaman bukti sebelum menetapkan tindakan.</small>
            </div>

            <form method="post" action="/incidents/{{ $incident->id }}/review">
                @csrf
                <div class="form-group">
                    <label for="status">Keputusan Pemeriksaan</label>
                    <select id="status" name="status">
                        <option value="confirmed" @selected($incident->status === 'confirmed')>Kejadian perlu tindak lanjut</option>
                        <option value="dismissed" @selected($incident->status === 'dismissed')>Peringatan keliru / tidak relevan</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="note">Catatan Pemeriksa</label>
                    <textarea id="note" name="note" rows="4" placeholder="Tulis catatan hasil pemeriksaan...">{{ $incident->review_note }}</textarea>
                </div>
                <button type="submit" class="w-full">Simpan Hasil Pemeriksaan</button>
            </form>
        </section>

        <section class="card">
            <div class="card-header">
                <div>
                    <h2>Pengiriman Notifikasi</h2>
                    <p>Status pengiriman ke admin/penerima</p>
                </div>
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Jalur</th>
                            <th>Status</th>
                            <th>Percobaan</th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse($deliveries as $delivery)
                            <tr>
                                <td><strong>{{ ucfirst($delivery->channel) }}</strong></td>
                                <td>
                                    <span class="badge {{ $delivery->status === 'sent' ? 'good' : ($delivery->status === 'failed' ? 'bad' : 'warn') }}">
                                        {{ $delivery->status }}
                                    </span>
                                </td>
                                <td>{{ $delivery->attempts }}x</td>
                            </tr>
                        @empty
                            <tr>
                                <td colspan="3" class="text-muted text-center">Tidak ada penerima notifikasi untuk jenis ini.</td>
                            </tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
        </section>
    </div>
</div>
@endsection

@extends('layout')
@section('title', ['overview'=>'Ringkasan','cameras'=>'Kamera','labels'=>'Label & invoice','incidents'=>'Kejadian','settings'=>'Pengaturan'][request('section','overview')] ?? 'Ringkasan')
@section('content')
@php
    $current = in_array(request('section'), ['cameras','labels','incidents','settings']) ? request('section') : 'overview';
    $titles = [
        'overview'  => ['Ringkasan Pemantauan', 'Status kamera dan catatan operasional terbaru dari toko.'],
        'cameras'   => ['Kamera Toko', 'Pantauan video langsung, pengelolaan, dan kalibrasi zona deteksi.'],
        'labels'    => ['Label & Invoice', 'Pemeriksaan hasil pembacaan QR/label dan status sinkronisasi SLM.'],
        'incidents' => ['Kejadian & Pemeriksaan', 'Daftar anomali dan kejadian yang memerlukan verifikasi manusia.'],
        'settings'  => ['Pengaturan Notifikasi', 'Konfigurasi akun penerima dan jenis peringatan darurat toko.']
    ];
@endphp

<div class="page-heading">
    <div>
        <p class="eyebrow">SLM ANEKA JAYA</p>
        <h1>{{ $titles[$current][0] }}</h1>
        <p>{{ $titles[$current][1] }}</p>
    </div>
    @if($current === 'overview')
        <a class="button secondary" href="{{ route('dashboard', ['section' => 'cameras']) }}">
            @include('partials.icon', ['name' => 'camera']) Lihat Semua Kamera
        </a>
    @endif
</div>

@if($current === 'overview')
    <div class="stats-grid">
        @foreach([
            ['camera', 'Kamera Aktif', $cameras->filter(fn($c) => $c->status === 'online' && $c->last_seen_at?->gt(now()->subMinute()))->count(), 'Dari '.$cameras->count().' kamera terdaftar', 'online'],
            ['label', 'Invoice Tertangkap', $totals['labels'], 'Total tangkapan kamera packing', 'labels'],
            ['report', 'Packing Selesai', $totals['packed'], 'Dikonfirmasi oleh staf', 'packed'],
            ['settings', 'Terkirim ke ERP', $totals['synced'], 'Terkonfirmasi tersimpan di SLM', 'synced']
        ] as [$icon, $text, $value, $caption, $metric])
            <div class="stat-card">
                <span class="stat-icon">@include('partials.icon', ['name' => $icon])</span>
                <span class="stat-label">{{ $text }}</span>
                <strong class="stat-value" data-metric="{{ $metric }}">{{ $value }}</strong>
                <div class="stat-bottom">
                    <span>{{ $caption }}</span>
                </div>
            </div>
        @endforeach
    </div>
@endif

@if(in_array($current, ['overview', 'cameras']))
    <section class="card">
        <div class="card-header">
            <div>
                <h2>{{ $current === 'overview' ? 'Pantauan Kamera Langsung' : 'Semua Kamera Terpasang' }}</h2>
                <p>Status realtime berdasarkan koneksi DVR RTSP toko</p>
            </div>
            @if($current === 'overview')
                <a href="{{ route('dashboard', ['section' => 'cameras']) }}">Kelola kamera →</a>
            @endif
        </div>

        <div class="monitor-toolbar">
            <div class="monitor-legend">
                <span class="legend-person">● Orang Terlacak</span>
                <span class="legend-object">● Objek / Dus</span>
                <small class="text-muted">Track anonim per kamera</small>
            </div>
            <div class="monitor-layout" role="group" aria-label="Tata letak kamera">
                <button type="button" class="secondary" data-grid="auto" aria-pressed="true">Semua</button>
                <button type="button" class="secondary" data-grid="1" aria-pressed="false">1 kolom</button>
                <button type="button" class="secondary" data-grid="2" aria-pressed="false">2 kolom</button>
            </div>
        </div>

        <div class="camera-grid" id="camera-wall">
            @forelse($cameras as $camera)
                @php $online = $camera->status === 'online' && $camera->last_seen_at?->gt(now()->subMinute()); @endphp
                <article class="camera-tile" data-camera-id="{{ $camera->id }}">
                    <div class="camera-preview">
                        <video data-camera-video muted autoplay playsinline controls aria-label="Video {{ $camera->name }}" hidden></video>
                        <img data-camera-frame alt="Gambar terbaru {{ $camera->name }}" hidden>
                        <div class="preview-placeholder" data-camera-placeholder>
                            @include('partials.icon', ['name' => 'camera'])
                            <span>Menunggu koneksi kamera...</span>
                        </div>
                        <button type="button" class="camera-fullscreen" data-camera-fullscreen aria-label="Perbesar {{ $camera->name }}">⛶</button>
                        <span data-camera-badge class="badge badge-dot {{ $online ? 'good' : 'bad' }}">
                            {{ $online ? 'Aktif' : 'Terhenti / Offline' }}
                        </span>
                    </div>
                    <div class="camera-track-summary">
                        <span data-track-summary>Memeriksa status AI…</span>
                        <span data-media-summary>Menunggu video</span>
                    </div>
                    <div class="camera-info">
                        <a href="{{ route('dashboard.camera', $camera) }}">{{ $camera->name }}</a>
                        <p>{{ $camera->location ?: 'Lokasi belum diisi' }}</p>
                        <div class="camera-meta">
                            <span data-camera-time>{{ $camera->last_seen_at ? $camera->last_seen_at->timezone('Asia/Jakarta')->format('H:i:s').' WIB' : 'Belum tersambung' }}</span>
                            <a href="{{ route('dashboard.camera', $camera) }}">Detail & Kalibrasi →</a>
                        </div>
                    </div>
                </article>
            @empty
                <div class="empty-state">
                    @include('partials.icon', ['name' => 'camera'])
                    <h3>Belum ada kamera terdaftar</h3>
                    <p>Tambahkan kamera setelah koneksi RTSP DVR selesai dikonfigurasi.</p>
                </div>
            @endforelse
        </div>
    </section>
@endif

@if($current === 'cameras')
    @if(auth()->user()->is_admin)
        <section class="card">
            <div class="card-header">
                <div>
                    <h2>Tambah Kamera Baru</h2>
                    <p>Daftarkan channel CCTV toko ke dalam pemantauan</p>
                </div>
            </div>
            <form method="post" action="/cameras">
                @csrf
                <div class="form-row">
                    <div>
                        <label for="name">Nama Kamera</label>
                        <input id="name" name="name" required placeholder="Contoh: Camera 14">
                    </div>
                    <div>
                        <label for="location">Lokasi / Area</label>
                        <input id="location" name="location" placeholder="Contoh: Meja Packing">
                    </div>
                    <div>
                        <label for="stream_env_key">Nama Variabel Stream</label>
                        <input id="stream_env_key" name="stream_env_key" required placeholder="CCTV_CAMERA_14_URL">
                    </div>
                </div>
                <p class="form-hint mt-2">URL RTSP dan kredensial sensitif disimpan aman di environment (.env), tidak disimpan dalam basis data.</p>
                <button type="submit" class="mt-4">Simpan Kamera Baru</button>
            </form>
        </section>
    @endif
@endif

@if(in_array($current, ['overview', 'labels']))
    <section class="card">
        <div class="card-header">
            <div>
                <h2>Invoice Packing & Sinkronisasi SLM</h2>
                <p id="dashboard-update-time">Diperbarui otomatis setiap 3 detik.</p>
            </div>
            <div class="flex items-center gap-2">
                <form method="post" action="/labels/sync-all" data-sync-form>
                    @csrf
                    <button type="submit" class="secondary btn-sm" title="Kirim semua invoice cocok yang tertunda atau gagal">
                        Sinkronkan Antrean ERP
                    </button>
                </form>
                <a href="{{ route('dashboard', ['section' => 'labels']) }}">Semua invoice →</a>
            </div>
        </div>

        @php $erpHealth = \App\Http\Controllers\DashboardController::checkErpHealth(); @endphp
        <div class="notice mb-4">
            @if($erpHealth['status'] === 'connected')
                <strong class="text-success">🟢 {{ $erpHealth['message'] }}</strong> · Sinkronisasi otomatis siap mengirim invoice dan konfirmasi packing.
            @elseif($erpHealth['status'] === 'disconnected')
                <strong class="text-danger">🔴 {{ $erpHealth['message'] }}</strong> · Invoice tetap dicatat lokal dan otomatis dikirim saat server terhubung kembali.
            @elseif($erpHealth['status'] === 'degraded')
                <strong class="text-warning">🟡 {{ $erpHealth['message'] }}</strong> · Layanan ERP merespons dengan kendala.
            @else
                <strong>Informasi Integrasi:</strong> ERP belum dikonfigurasi. Invoice dan foto bukti tetap tersimpan aman di lokal aplikasi.
            @endif
        </div>

        <div id="invoice-feed">
            @include('partials.invoices')
        </div>
    </section>
@endif

@if(in_array($current, ['overview', 'incidents']))
    <section class="card">
        <div class="card-header">
            <div>
                <h2>Kejadian & Peringatan Terbaru</h2>
                <p>Riwayat temuan anomali toko · Waktu WIB</p>
            </div>
            <a href="{{ route('dashboard', ['section' => 'incidents']) }}">Daftar semua kejadian →</a>
        </div>
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>Waktu (WIB)</th>
                        <th>Kamera</th>
                        <th>Jenis Kejadian</th>
                        <th>Alasan Terdeteksi</th>
                        <th>Status Pemeriksaan</th>
                    </tr>
                </thead>
                <tbody>
                    @forelse($incidents as $incident)
                        <tr>
                            <td>{{ $incident->occurred_at->timezone('Asia/Jakarta')->format('d M Y H:i:s') }}</td>
                            <td>{{ $incident->camera?->name ?? 'Kamera' }}</td>
                            <td>
                                <a href="{{ route('dashboard.incident', $incident) }}">
                                    <strong>{{ $incident->type === 'anomaly' ? 'Dugaan Anomali' : ($incident->type === 'person_absent' ? 'Track Tidak Terlihat' : ($incident->type === 'label_needs_review' ? 'Verifikasi Resi/Label' : 'Pemantauan Terhenti')) }}</strong>
                                </a>
                            </td>
                            <td>{{ $incident->reason }}</td>
                            <td>
                                <span class="badge {{ $incident->status === 'needs_review' ? 'warn' : ($incident->status === 'confirmed' ? 'bad' : 'good') }}">
                                    {{ ['needs_review' => 'Perlu Diperiksa', 'confirmed' => 'Ditindaklanjuti', 'dismissed' => 'Peringatan Keliru'][$incident->status] ?? $incident->status }}
                                </span>
                            </td>
                        </tr>
                    @empty
                        <tr>
                            <td colspan="5" class="text-center text-muted">Belum ada catatan kejadian atau anomali.</td>
                        </tr>
                    @endforelse
                </tbody>
            </table>
        </div>
        @if($current === 'incidents')
            <div class="pagination-wrap">
                {{ $incidents->withQueryString()->links('vendor.pagination.cctv-pagination') }}
            </div>
        @endif
    </section>
@endif

@if($current === 'settings')
    @if(auth()->user()->is_admin)
        <section class="card">
            <div class="card-header">
                <div>
                    <h2>Tambah Akun Pemeriksa / User</h2>
                    <p>Daftarkan akun staf yang berhak mengakses sistem</p>
                </div>
            </div>
            <form method="post" action="/users">
                @csrf
                <div class="form-row">
                    <div>
                        <label for="user_name">Nama Pengguna</label>
                        <input id="user_name" name="name" required placeholder="Nama lengkap staf">
                    </div>
                    <div>
                        <label for="user_email">Alamat Email</label>
                        <input id="user_email" name="email" type="email" required placeholder="email@anekajaya.com">
                    </div>
                    <div>
                        <label for="user_pass">Kata Sandi Awal</label>
                        <input id="user_pass" name="password" type="password" minlength="12" required placeholder="Minimal 12 karakter">
                    </div>
                    <div class="flex-none">
                        <button type="submit">Tambah Pengguna</button>
                    </div>
                </div>
            </form>
        </section>
    @endif

    <section class="card">
        <div class="card-header">
            <div>
                <h2>Aturan Notifikasi Otomatis</h2>
                <p>Tentukan penerima dan jalur notifikasi saat terjadi kejadian</p>
            </div>
        </div>
        
        <p class="text-sm text-muted">Push notification menggunakan FCM. WhatsApp menggunakan template resmi Meta.</p>

        <form method="post" action="/notification-rules">
            @csrf
            <div class="form-row">
                @if(auth()->user()->is_admin)
                    <div>
                        <label for="rule_user">Penerima</label>
                        <select id="rule_user" name="user_id">
                            @foreach($users as $user)
                                <option value="{{ $user->id }}">{{ $user->name }} ({{ $user->email }})</option>
                            @endforeach
                        </select>
                    </div>
                @endif
                <div>
                    <label for="incident_type">Jenis Kejadian</label>
                    <select id="incident_type" name="incident_type">
                        <option value="anomaly">Dugaan Anomali</option>
                        <option value="camera_offline">Kamera Terhenti</option>
                        <option value="person_absent">Track Tidak Terlihat</option>
                        <option value="worker_offline">Proses AI Terhenti</option>
                    </select>
                </div>
                <div>
                    <label for="channel">Jalur Pengiriman</label>
                    <select id="channel" name="channel">
                        <option value="email">Email</option>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="push">Push Notification</option>
                    </select>
                </div>
                <div>
                    <label for="whatsapp_number">Nomor WhatsApp</label>
                    <input id="whatsapp_number" name="whatsapp_number" placeholder="+628123456789">
                </div>
                <div>
                    <label for="enabled">Status</label>
                    <select id="enabled" name="enabled">
                        <option value="1">Aktif</option>
                        <option value="0">Nonaktif</option>
                    </select>
                </div>
                <div class="flex-none">
                    <button type="submit">Simpan Aturan</button>
                </div>
            </div>
        </form>

        <div class="mt-6">
            <h3>Daftar Aturan Notifikasi Tersimpan</h3>
            <div class="table-wrap mt-2">
                <table>
                    <thead>
                        <tr>
                            <th>Email Penerima</th>
                            <th>Jenis Peringatan</th>
                            <th>Jalur</th>
                            <th>No. WhatsApp</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse($rules as $rule)
                            <tr>
                                <td>{{ $rule->email }}</td>
                                <td>
                                    <span class="badge">
                                        {{ ['anomaly' => 'Dugaan Anomali', 'camera_offline' => 'Kamera Terhenti', 'person_absent' => 'Track Tidak Terlihat', 'worker_offline' => 'Proses AI Terhenti'][$rule->incident_type] ?? $rule->incident_type }}
                                    </span>
                                </td>
                                <td><strong>{{ ucfirst($rule->channel) }}</strong></td>
                                <td>{{ $rule->whatsapp_number ?: '-' }}</td>
                                <td>
                                    <span class="badge {{ $rule->enabled ? 'good' : 'warn' }}">
                                        {{ $rule->enabled ? 'Aktif' : 'Nonaktif' }}
                                    </span>
                                </td>
                            </tr>
                        @empty
                            <tr>
                                <td colspan="5" class="text-center text-muted">Belum ada aturan notifikasi yang disimpan.</td>
                            </tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
        </div>
    </section>
@endif
@endsection

@push('scripts')
@if(in_array($current, ['overview', 'cameras', 'labels']))
    <script src="/vendor/hls.min.js"></script>
    <script src="/js/monitoring.js?v=2" defer></script>
@endif
@endpush

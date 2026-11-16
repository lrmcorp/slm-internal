@extends('layout')
@section('title', 'Laporan Orang & Track')
@section('content')
<div class="page-heading">
    <div>
        <p class="eyebrow">LAPORAN PEMANTAUAN TOKO</p>
        <h1>Laporan Orang & Track Anonim</h1>
        <p>Riwayat deteksi pergerakan dan klasifikasi pemeriksa · Waktu WIB</p>
    </div>
</div>

<div class="notice">
    <strong>Catatan Pemeriksaan:</strong> Customer, staf, dan pengunjung ditandai oleh manusia. Track anonim tidak mendeteksi identitas wajah. Jumlah track mencerminkan sesi pergerakan kamera, bukan jumlah orang unik.
</div>

<!-- Filter Laporan -->
<section class="card">
    <div class="card-header">
        <div>
            <h2>Filter Data Track</h2>
            <p>Pilih periode waktu atau status klasifikasi</p>
        </div>
    </div>
    <form method="get" class="form-row">
        <div>
            <label for="classification">Klasifikasi</label>
            <select id="classification" name="classification">
                <option value="">Semua Klasifikasi</option>
                @foreach(['customer' => 'Customer', 'staff' => 'Staf', 'visitor' => 'Pengunjung', 'unclassified' => 'Belum diklasifikasikan'] as $value => $label)
                    <option value="{{ $value }}" @selected(request('classification') === $value)>{{ $label }}</option>
                @endforeach
            </select>
        </div>
        <div>
            <label for="from">Dari Tanggal/Waktu</label>
            <input id="from" type="datetime-local" name="from" value="{{ request('from') ? \Carbon\Carbon::parse(request('from'), 'Asia/Jakarta')->timezone('Asia/Jakarta')->format('Y-m-d\TH:i') : '' }}">
        </div>
        <div>
            <label for="to">Sampai Tanggal/Waktu</label>
            <input id="to" type="datetime-local" name="to" value="{{ request('to') ? \Carbon\Carbon::parse(request('to'), 'Asia/Jakarta')->timezone('Asia/Jakarta')->format('Y-m-d\TH:i') : '' }}">
        </div>
        <div class="flex-none">
            <button type="submit">Tampilkan Laporan</button>
        </div>
    </form>
</section>

<!-- Tabel Laporan -->
<section class="card">
    <div class="card-header">
        <div>
            <h2>Daftar Sesi Track</h2>
            <p>Data sesi terlacak pada kamera toko</p>
        </div>
    </div>
    <div class="table-wrap">
        <table>
            <thead>
                <tr>
                    <th>Kamera / Track ID</th>
                    <th>Pertama & Terakhir Terlihat</th>
                    <th>Klasifikasi</th>
                    <th>Status Peringatan</th>
                </tr>
            </thead>
            <tbody>
                @forelse($tracks as $track)
                    <tr>
                        <td>
                            <strong>{{ $track->camera?->name ?? 'Kamera' }}</strong> · Track #{{ $track->track_id }}<br>
                            <small class="text-muted">Sesi: {{ substr($track->session_id, 0, 8) }}</small>
                        </td>
                        <td>
                            <span>Mulai: {{ $track->first_seen_at->timezone('Asia/Jakarta')->format('d M Y H:i:s') }}</span><br>
                            <small class="text-muted">Selesai: {{ $track->last_seen_at->timezone('Asia/Jakarta')->format('d M Y H:i:s') }}</small>
                        </td>
                        <td>
                            @php
                                $classBadge = match($track->classification) {
                                    'customer' => 'good',
                                    'staff'    => 'good',
                                    'visitor'  => 'warn',
                                    default    => ''
                                };
                            @endphp
                            <span class="badge {{ $classBadge }} mb-2">
                                {{ ['unclassified' => 'Belum Diperiksa', 'customer' => 'Customer', 'staff' => 'Staf', 'visitor' => 'Pengunjung'][$track->classification] ?? $track->classification }}
                            </span>
                            
                            @if(auth()->user()->is_admin)
                                <form class="classification-form form-row mt-1" action="/presence/{{ $track->id }}/classification">
                                    @csrf
                                    <div class="min-w-140">
                                        <select name="classification" class="btn-sm">
                                            @foreach(['unclassified' => 'Belum Diperiksa', 'customer' => 'Customer', 'staff' => 'Staf', 'visitor' => 'Pengunjung'] as $value => $label)
                                                <option value="{{ $value }}" @selected($track->classification === $value)>{{ $label }}</option>
                                            @endforeach
                                        </select>
                                    </div>
                                    <button type="submit" class="secondary btn-sm">Ubah</button>
                                </form>
                            @endif
                        </td>
                        <td>
                            @if($track->absence_alerted_at)
                                <span class="badge warn">Track Tidak Terlihat</span><br>
                                <small class="text-muted">Perlu dicek pemeriksa</small>
                            @else
                                <span class="badge good">Normal</span>
                            @endif
                        </td>
                    </tr>
                @empty
                    <tr>
                        <td colspan="4">
                            <div class="empty-state">
                                <h3>Belum ada track pada periode ini</h3>
                                <p>Track akan otomatis tercatat ketika model pelacak mendeteksi pergerakan kamera.</p>
                            </div>
                        </td>
                    </tr>
                @endforelse
            </tbody>
        </table>
    </div>
    <div class="pagination-wrap">
        {{ $tracks->withQueryString()->links('vendor.pagination.cctv-pagination') }}
    </div>
</section>
@endsection

@push('scripts')
<script>
document.querySelectorAll('.classification-form').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    const result = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: {'Accept': 'application/json'}
    });
    if (result.ok) {
        location.reload();
    } else {
        alert('Gagal menyimpan klasifikasi.');
    }
}));
</script>
@endpush

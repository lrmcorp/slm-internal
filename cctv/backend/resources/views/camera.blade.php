@extends('layout')
@section('title', $camera->name)
@section('content')
<nav class="breadcrumb-nav" aria-label="Breadcrumb">
    <a href="{{ route('dashboard', ['section' => 'cameras']) }}">
        @include('partials.icon', ['name' => 'camera'])
        <span>Semua Kamera</span>
    </a>
    <span class="separator">›</span>
    <span class="current">{{ $camera->name }}</span>
</nav>

<div class="page-heading">
    <div>
        <p class="eyebrow">DETAIL KAMERA</p>
        <h1>{{ $camera->name }}</h1>
        <p>{{ $camera->location ?: 'Lokasi belum diisi' }}</p>
    </div>
</div>

<section class="card">
    <div class="card-header">
        <div>
            <h2>Gambar Terbaru & Video Live</h2>
            <p>HLS Video Live otomatis dengan fallback frame gambar deteksi</p>
        </div>
        <span class="badge {{ $camera->status === 'online' ? 'good' : 'bad' }}">
            {{ $camera->status === 'online' ? 'Status: Online' : 'Status: Offline' }}
        </span>
    </div>

    <div class="video-viewport-box">
        <video id="live-video" controls muted autoplay playsinline></video>
        <img id="live-image" alt="Gambar kamera terbaru">
    </div>

    <div class="notice">
        <p id="video-status" class="mb-2"><strong>Video Live HLS:</strong> Menggunakan jeda beberapa detik. Bila belum tersedia, gambar terbaru tetap ditampilkan.</p>
        <p id="live-status" class="mb-0 text-sm text-muted">Gambar diperbarui sekitar setiap 2 detik. Ini adalah gambar cadangan; ID track anonim dapat berubah saat tertutup atau koneksi diulang.</p>
    </div>

    @if(auth()->user()->is_admin)
    <form method="post" action="/cameras/{{ $camera->id }}/presence-settings" class="card form-row mt-4">
        @csrf
        <div>
            <label for="absence_seconds">Batas tidak terlihat (detik)</label>
            <input id="absence_seconds" name="absence_seconds" type="number" min="60" max="86400" value="{{ $camera->absence_seconds }}" required>
        </div>
        <div>
            <label for="presence_alerts_enabled">Peringatan track anonim</label>
            <select id="presence_alerts_enabled" name="presence_alerts_enabled">
                <option value="0" @selected(!$camera->presence_alerts_enabled)>Mati</option>
                <option value="1" @selected($camera->presence_alerts_enabled)>Aktif</option>
            </select>
        </div>
        <div>
            <button type="submit">Simpan Pengaturan</button>
        </div>
    </form>
    @endif
    <p class="text-sm text-muted mt-2">Model pelacak: <strong>{{ $camera->detector_ready ? 'Tersedia' : 'Belum tersedia' }}</strong>. Track tidak mengidentifikasi wajah. Klasifikasi dilakukan oleh pemeriksa.</p>
</section>

<div class="grid">
    <section class="card">
        <div class="card-header">
            <div>
                <h2>Kalibrasi Zona Kamera</h2>
                <p>Tandai batas toko, area packing, dan jalur barang</p>
            </div>
        </div>
        <p class="text-sm text-muted">Unggah satu gambar asli dari kamera ini. Klik pada gambar untuk menandai titik poligon. Zona dapat disimpan sebagai draf sebelum disetujui.</p>
        
        @if(auth()->user()->is_admin)
        <form method="post" enctype="multipart/form-data" action="/cameras/{{ $camera->id }}/reference" class="form-row mb-4">
            @csrf
            <div>
                <input type="file" name="image" accept="image/*" required>
            </div>
            <div>
                <button type="submit" class="secondary">Unggah frame referensi</button>
            </div>
        </form>
        @endif

        @if($camera->reference_path)
            <p class="text-xs text-muted mb-2">Koordinat disimpan relatif terhadap ukuran frame sehingga tetap presisi pada semua resolusi layar.</p>
            <div class="canvas-editor-box" id="frame">
                <img id="reference" src="{{ route('dashboard.evidence', ['kind' => 'camera-reference', 'id' => $camera->id]) }}" alt="Frame kalibrasi kamera">
                <canvas class="canvas-editor-overlay" id="zones-canvas"></canvas>
            </div>
            
            @if(auth()->user()->is_admin)
            <div class="form-row mt-4">
                <div>
                    <label for="zone-type">Zona yang digambar</label>
                    <select id="zone-type">
                        <option value="store_boundary">Batas toko / area dalam</option>
                        <option value="danger_zone">Danger zone</option>
                        <option value="packing_area">Area packing yang terlihat</option>
                        <option value="box_area">Area asal barang</option>
                        <option value="packing_route">Jalur pengemasan</option>
                    </select>
                </div>
                <div class="btn-group">
                    <button type="button" class="secondary" id="undo-point">Hapus titik terakhir</button>
                    <button type="button" class="secondary" id="clear-zone">Hapus zona terpilih</button>
                    <button type="button" id="save-zones">Simpan semua zona</button>
                </div>
            </div>
            <p id="zone-message" class="text-muted mt-2 text-sm"></p>
            @endif
        @endif
    </section>

    <section class="card">
        <div class="card-header">
            <div>
                <h2>Status & Konfigurasi Stream</h2>
                <p>Rincian teknis koneksi kamera</p>
            </div>
        </div>
        <p>
            <strong>Lokasi:</strong> {{ $camera->location ?: 'Belum diisi' }}<br>
            <strong>Variabel Stream:</strong> <code>{{ $camera->stream_env_key }}</code><br>
            <strong>Heartbeat Terakhir:</strong> {{ $camera->last_seen_at ? $camera->last_seen_at->timezone('Asia/Jakarta')->format('d M Y H:i:s').' WIB' : 'Belum pernah tersambung' }}<br>
            <strong>Persetujuan Zona:</strong> 
            @if($camera->zones_approved_at)
                <span style="color: #16a34a; font-weight: 600;">✓ Aktif & Disetujui ({{ $camera->zones_approved_at->timezone('Asia/Jakarta')->format('d M Y H:i') }} WIB)</span>
            @else
                <span style="color: #dc2626; font-weight: 600;">Belum disetujui</span>
            @endif
        </p>

        @if(auth()->user()->is_admin)
            <form method="post" action="{{ route('dashboard.camera.apply-full-frame', $camera) }}" class="mt-4">
                @csrf
                <button type="submit" class="w-full" style="background: #0f172a; color: #38bdf8; border: 1px solid #38bdf8; padding: 0.6rem 1rem; border-radius: 6px; cursor: pointer; font-weight: 600;">
                    ⚡ Terapkan Full-Frame Auto-Zone (100% Layar)
                </button>
            </form>
            <p class="form-hint" style="font-size: 0.8rem; color: #64748b; margin-top: 0.25rem;">Mengatur seluruh tangkapan kamera menjadi area kerja packing aktif tanpa perlu menggambar titik manual.</p>
        @endif

        @php($zoneTypes = collect($camera->zones ?? [])->pluck('type'))
        @if($camera->zones && auth()->user()->is_admin && $camera->reference_path && $zoneTypes->contains('store_boundary') && $zoneTypes->contains('box_area') && $zoneTypes->contains('packing_route') && !$camera->zones_approved_at)
            <form method="post" action="/cameras/{{ $camera->id }}/zones/approve" class="mt-4">
                @csrf
                <button type="submit" class="w-full">Setujui Penempatan Zona Manual</button>
            </form>
            <p class="form-hint">Persetujuan dibatalkan otomatis saat frame referensi atau titik zona diubah.</p>
        @elseif($camera->zones && !$camera->zones_approved_at)
            <div class="notice mt-4">
                <small>Draf tersimpan. Persetujuan belum tersedia sampai batas toko, area asal barang, dan jalur barang yang sah dipastikan lengkap.</small>
            </div>
        @endif
    </section>
</div>
@endsection

@push('scripts')
@if($camera->reference_path && auth()->user()->is_admin)
<script>
(() => {
    const img = document.getElementById('reference');
    const canvas = document.getElementById('zones-canvas');
    const ctx = canvas.getContext('2d');
    const select = document.getElementById('zone-type');
    const message = document.getElementById('zone-message');
    const colors = {
        store_boundary: '#00b8d9',
        danger_zone: '#f44336',
        packing_area: '#16b977',
        box_area: '#ffbf00',
        packing_route: '#9063df'
    };
    const zones = {store_boundary:[], danger_zone:[], packing_area:[], box_area:[], packing_route:[]};
    for (const zone of @json($camera->zones ?? [])) {
        zones[zone.type] = zone.points;
    }
    
    function draw() {
        canvas.width = img.clientWidth;
        canvas.height = img.clientHeight;
        ctx.lineWidth = 3;
        for (const [type, points] of Object.entries(zones)) {
            if (!points.length) continue;
            ctx.strokeStyle = colors[type];
            ctx.fillStyle = colors[type] + '30';
            ctx.beginPath();
            points.forEach(([x, y], i) => {
                if (i === 0) ctx.moveTo(x * canvas.width, y * canvas.height);
                else ctx.lineTo(x * canvas.width, y * canvas.height);
            });
            if (points.length >= 3) {
                ctx.closePath();
                ctx.fill();
            }
            ctx.stroke();
            for (const [x, y] of points) {
                ctx.beginPath();
                ctx.arc(x * canvas.width, y * canvas.height, 5, 0, Math.PI * 2);
                ctx.fillStyle = colors[type];
                ctx.fill();
            }
        }
    }
    img.onload = draw;
    window.addEventListener('resize', draw);
    draw();

    canvas.addEventListener('click', e => {
        const r = canvas.getBoundingClientRect();
        zones[select.value].push([
            Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
            Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
        ]);
        draw();
    });

    document.getElementById('undo-point').onclick = () => {
        zones[select.value].pop();
        draw();
    };
    document.getElementById('clear-zone').onclick = () => {
        zones[select.value] = [];
        draw();
    };
    document.getElementById('save-zones').onclick = async () => {
        if (!Object.values(zones).some(p => p.length >= 3) || Object.values(zones).some(p => p.length > 0 && p.length < 3)) {
            message.textContent = 'Gambar minimal satu zona dengan tiga titik.';
            return;
        }
        const response = await fetch('/cameras/{{ $camera->id }}/zones', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').content
            },
            body: JSON.stringify({
                zones: Object.entries(zones)
                    .filter(([, points]) => points.length >= 3)
                    .map(([type, points]) => ({type, points}))
            })
        });
        message.textContent = response.ok ? 'Zona tersimpan. Periksa lagi, lalu setujui di panel Status.' : 'Gagal menyimpan zona.';
        if (response.ok) setTimeout(() => location.reload(), 900);
    };
})();
</script>
@endif

<script src="/vendor/hls.min.js"></script>
<script>
const player = document.getElementById('live-video');
const stream = '/cameras/{{ $camera->id }}/live/stream.m3u8';
if (window.Hls && Hls.isSupported()) {
    const hls = new Hls();
    hls.loadSource(stream);
    hls.attachMedia(player);
    hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) document.getElementById('video-status').textContent = 'Video live belum tersedia atau koneksi terputus. Periksa status kamera.';
    });
} else if (player.canPlayType('application/vnd.apple.mpegurl')) {
    player.src = stream;
}

const liveImage = document.getElementById('live-image');
let liveBusy = false;
async function refreshLive() {
    if (document.hidden || liveBusy) return;
    liveBusy = true;
    try {
        const response = await fetch('/cameras/{{ $camera->id }}/live-frame', {cache: 'no-store'});
        if (!response.ok) throw new Error('Belum ada gambar');
        const when = response.headers.get('X-Frame-Time');
        const stale = !when || Date.now() - Date.parse(when) > 20000;
        document.getElementById('live-status').textContent = (stale ? 'Gambar lama; periksa koneksi. ' : 'Gambar terbaru: ') + (when ? new Date(when).toLocaleString('id-ID') : 'waktu tidak tersedia');
        const url = URL.createObjectURL(await response.blob());
        const old = liveImage.src;
        liveImage.src = url;
        if (old.startsWith('blob:')) URL.revokeObjectURL(old);
    } catch (e) {
        document.getElementById('live-status').textContent = 'Gambar belum tersedia atau koneksi terputus.';
    } finally {
        liveBusy = false;
    }
}
refreshLive();
setInterval(refreshLive, 5000);
</script>
@endpush

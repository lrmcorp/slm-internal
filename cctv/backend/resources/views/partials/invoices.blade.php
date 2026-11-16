<div class="table-wrap">
    <table>
        <thead>
            <tr>
                <th>Invoice / Customer</th>
                <th>Kamera</th>
                <th>Pertama Tertangkap</th>
                <th>Status Packing</th>
                <th>Pencocokan SLM</th>
                <th>Pengiriman ERP</th>
                <th>Tindakan & Bukti</th>
            </tr>
        </thead>
        <tbody>
            @forelse($labels as $label)
                <tr>
                    <td>
                        <a href="{{ route('dashboard.label', $label) }}">
                            <strong>{{ $label->field_one }}</strong>
                        </a>
                        <br>
                        <small class="text-muted">{{ $label->field_two ?: 'Customer perlu diperiksa' }} · {{ $label->field_three ?: 'Sumber belum diisi' }}</small>
                    </td>
                    <td>{{ $label->camera?->name ?? 'Kamera' }}</td>
                    <td>{{ $label->first_seen_at?->timezone('Asia/Jakarta')->format('d M Y H:i:s') ?? '-' }}</td>
                    <td>
                        @if($label->packing_completed_at)
                            <span class="badge good">Selesai Dikonfirmasi</span>
                            <br>
                            <small class="text-muted">{{ $label->packing_completed_at->timezone('Asia/Jakarta')->format('d M H:i:s') }} WIB</small>
                        @else
                            <span class="badge warn">Belum Selesai</span>
                        @endif
                    </td>
                    <td>
                        <span class="badge {{ $label->slm_status === 'matched' ? 'good' : 'warn' }}">
                            {{ ['matched' => 'Cocok', 'not_found' => 'Tidak Ditemukan', 'incomplete' => 'Data Belum Lengkap', 'unavailable' => 'Belum Terhubung', 'error' => 'Gagal'][$label->slm_status] ?? $label->slm_status }}
                        </span>
                        @if($label->slm_reference)
                            <br><small class="text-muted">{{ $label->slm_reference }}</small>
                        @endif
                    </td>
                    <td>
                        <span class="badge {{ $label->slm_sync_status === 'synced' ? 'good' : ($label->slm_sync_status === 'error' ? 'bad' : 'warn') }}">
                            {{ ['not_ready' => 'Belum Terkirim', 'pending_configuration' => 'Menunggu Integrasi', 'queued' => 'Dalam Antrean', 'synced' => 'Tersimpan di ERP', 'missing_photo' => 'Foto Belum Siap', 'error' => 'Gagal Kirim'][$label->slm_sync_status] ?? $label->slm_sync_status }}
                        </span>
                        @if($label->slm_synced_at)
                            <br><small class="text-muted">{{ $label->slm_synced_at->timezone('Asia/Jakarta')->format('d M H:i:s') }} WIB</small>
                        @endif
                    </td>
                    <td>
                        <div class="flex flex-col gap-1">
                            <a href="{{ route('dashboard.label', $label) }}" class="text-sm">Periksa invoice →</a>
                            @if($label->evidence_path)
                                <a href="{{ route('dashboard.evidence', ['kind' => 'label-snapshot', 'id' => $label->id]) }}" class="text-xs text-muted" target="_blank">Lihat foto bukti</a>
                            @endif
                        </div>
                        @if($label->review_status === 'confirmed' && !$label->packing_completed_at)
                            <form method="post" action="/labels/{{ $label->id }}/packing-complete" data-packing-form class="mt-2">
                                @csrf
                                <button type="submit" class="secondary btn-sm w-full">Konfirmasi Selesai</button>
                            </form>
                        @endif
                        @if($label->slm_status === 'matched' && in_array($label->review_status, ['confirmed', 'auto_read', 'auto_verified'], true) && !in_array($label->slm_sync_status, ['synced', 'queued'], true))
                            <form method="post" action="/labels/{{ $label->id }}/sync" data-sync-form class="mt-2">
                                @csrf
                                <button type="submit" class="{{ $label->slm_sync_status === 'error' ? 'warn' : 'secondary' }} btn-sm w-full">
                                    {{ $label->slm_sync_status === 'error' ? 'Kirim Ulang ke ERP' : 'Sinkronkan ke ERP' }}
                                </button>
                            </form>
                        @endif
                    </td>
                </tr>
            @empty
                <tr>
                    <td colspan="7">
                        <div class="empty-state">
                            <h3>Belum ada invoice tertangkap</h3>
                            <p>Invoice akan otomatis tercatat saat barcode/QR label terbaca pada kamera meja packing.</p>
                        </div>
                    </td>
                </tr>
            @endforelse
        </tbody>
    </table>
</div>
@if(isset($current) && $current === 'labels')
    <div class="pagination-wrap">
        {{ $labels->withQueryString()->links('vendor.pagination.cctv-pagination') }}
    </div>
@endif

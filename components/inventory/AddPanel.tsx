import type { ReactNode } from "react";

/**
 * Form tambah data yang tertutup sampai dibutuhkan. Tombolnya di atas daftar,
 * jadi tidak perlu gulir ke bawah; saat tertutup tidak memakan tempat.
 * Pakai <details> agar tetap jalan tanpa JavaScript dan bisa dibuka lewat keyboard.
 */
export function AddPanel({ label, defaultOpen = false, children }: { label: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className="group mb-6" open={defaultOpen}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm bg-brand-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 group-open:border group-open:border-neutral-300 group-open:bg-white group-open:text-neutral-700 group-open:hover:bg-brand-50 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-base leading-none group-open:hidden">+</span>
        <span className="group-open:hidden">{label}</span>
        <span className="hidden group-open:inline">Tutup form</span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

/** Pengaturan yang jarang diubah: satu baris ringkas berisi nilai aktif, dibuka hanya untuk mengubah. */
export function SettingsPanel({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="group aj-surface mb-6">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">{summary}</span>
        <span className="font-semibold text-brand-800 underline group-open:hidden">Ubah</span>
        <span className="hidden font-semibold text-brand-800 underline group-open:inline">Tutup</span>
      </summary>
      <div className="divide-y divide-slate-100 border-t border-slate-100">{children}</div>
    </details>
  );
}

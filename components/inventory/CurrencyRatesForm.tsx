"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/ToastProvider";
import { displayCurrency, type ManualRateCurrency } from "@/lib/currency/displayCurrencies";

export type ManualRateRow = { currency: ManualRateCurrency; rate: number | null; updatedAt?: string; updatedBy?: string | null };

/** "12.150" atau "468,5" → angka. Titik dibaca sebagai pemisah ribuan, koma sebagai desimal. */
export function parseRateInput(text: string) {
  const cleaned = text.trim().replace(/\./g, "").replace(",", ".");
  const value = Number(cleaned);
  return cleaned && Number.isFinite(value) ? value : NaN;
}

const shown = (rate: number | null) => (rate ? rate.toLocaleString("id-ID", { maximumFractionDigits: 4 }) : "");

/** Kurs SGD, MYR, dan THB. Hanya untuk menampilkan harga; harga yang tersimpan tetap Rupiah. */
export function CurrencyRatesForm({ rates, canManage }: { rates: ManualRateRow[]; canManage: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(rates.map((row) => [row.currency, shown(row.rate)])));
  const [busy, setBusy] = useState<string | null>(null);

  async function save(currency: ManualRateCurrency) {
    const rate = parseRateInput(values[currency] ?? "");
    if (!(rate > 0)) return showToast(`Isi kurs ${currency} dengan angka lebih dari 0.`, "error");
    setBusy(currency);
    try {
      const res = await fetch("/api/inventory/settings/currency-rates", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currency, rate }) });
      const json = await res.json().catch(() => null);
      if (!json?.success) return showToast(json?.message || "Kurs gagal disimpan.", "error");
      showToast(`Kurs ${currency} disimpan: Rp ${rate.toLocaleString("id-ID", { maximumFractionDigits: 4 })}.`, "success");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="p-4">
      <h3 className="font-bold text-slate-800">Kurs Singapura, Malaysia, dan Thailand</h3>
      <p className="mt-1 text-sm text-slate-600">
        Dipakai untuk menampilkan harga dalam mata uang lain di tabel Master Barang dan di Katalog. Harga modal, harga jual, dan pesanan tetap dicatat dalam Rupiah.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {rates.map((row) => {
          const currency = displayCurrency(row.currency);
          const inputId = `kurs-${row.currency}`;
          return (
            <div key={row.currency} className="min-w-0 rounded-lg border border-slate-200 p-3">
              <label htmlFor={inputId} className="text-sm font-semibold text-slate-800">{currency.country} · Rp per 1 {row.currency}</label>
              <div className="mt-1 flex items-center gap-2">
                <div className="flex min-h-11 min-w-0 flex-1 items-center rounded-lg border border-slate-300 bg-white focus-within:border-brand-600">
                  <span className="pl-3 text-sm font-semibold text-slate-500">Rp</span>
                  <input
                    id={inputId}
                    inputMode="decimal"
                    disabled={!canManage}
                    className="w-full min-w-0 flex-1 bg-transparent px-2 py-2 text-right text-sm tabular-nums outline-none disabled:text-slate-500"
                    value={values[row.currency] ?? ""}
                    placeholder="belum diatur"
                    onChange={(event) => setValues((current) => ({ ...current, [row.currency]: event.target.value.replace(/[^\d.,]/g, "").slice(0, 14) }))}
                  />
                </div>
                {canManage && <Button className="min-h-11 shrink-0" onClick={() => save(row.currency)} disabled={busy !== null}>{busy === row.currency ? "Menyimpan..." : "Simpan"}</Button>}
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {row.rate ? <>Aktif: <b>Rp {shown(row.rate)}</b>{row.updatedAt ? ` · diubah ${new Date(row.updatedAt).toLocaleDateString("id-ID")}${row.updatedBy ? ` oleh ${row.updatedBy}` : ""}` : ""}</> : "Belum diatur, jadi belum bisa dipilih."}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

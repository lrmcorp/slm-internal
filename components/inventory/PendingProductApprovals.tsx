"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { MoneyInput } from "@/components/ui/MoneyInput";
import { useToast } from "@/components/ui/ToastProvider";
import type { PendingProduct } from "@/lib/inventory/productApproval";

const rupiah = (value: number) => `Rp${Math.round(value).toLocaleString("id-ID")}`;

/** Barang baru dari Input Penjualan yang menunggu persetujuan Owner sebelum masuk Master Barang. */
export function PendingProductApprovals({ rows }: { rows: PendingProduct[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [prices, setPrices] = useState<Record<string, number | undefined>>(() => Object.fromEntries(rows.map((row) => [row.id, row.sellingPrice])));
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PendingProduct | null>(null);

  async function decide(row: PendingProduct, action: "approve" | "reject") {
    setBusy(row.id);
    try {
      const res = await fetch(`/api/inventory/products/${encodeURIComponent(row.id)}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "approve" ? { action, sellingPrice: prices[row.id] ?? row.sellingPrice } : { action })
      });
      const json = await res.json().catch(() => null);
      if (!json?.success) return showToast(json?.message || "Persetujuan gagal disimpan.", "error");
      showToast(action === "approve" ? `${row.sku} masuk Master Barang.` : `${row.sku} ditolak.`, "success");
      router.refresh();
    } finally {
      setBusy(null);
      setRejecting(null);
    }
  }

  if (!rows.length) return null;
  return (
    <section id="persetujuan-barang" className="mb-4 scroll-mt-20 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <h2 className="font-bold text-slate-900">Barang baru menunggu persetujuan ({rows.length})</h2>
      <p className="mt-1 text-sm text-slate-700">
        Dibuat dari Input Penjualan karena belum ada di Master Barang. Setujui untuk memasukkannya ke Master Barang dengan harga jual di bawah dan harga modal Rp0. Penjualan yang sudah memakainya tetap tersimpan, apa pun keputusannya.
      </p>
      <ul className="mt-3 space-y-3">
        {rows.map((row) => (
          <li key={row.id} className="rounded-lg border border-amber-200 bg-white p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="min-w-0 font-semibold text-slate-900">
                <span className="font-mono">{row.sku}</span> · {row.name}
              </p>
              <p className="text-xs text-slate-600">
                {row.unit}{row.category ? ` · ${row.category}` : ""}
                {row.requestedByName ? ` · diminta ${row.requestedByName}` : ""}
                {row.requestedAt ? `, ${new Date(row.requestedAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" })}` : ""}
              </p>
            </div>
            {row.sales.length > 0 && (
              <p className="mt-1 text-xs text-slate-600">
                Dipakai di: {row.sales.map((sale) => `${sale.number} (${sale.customerName}, ${sale.quantity.toLocaleString("id-ID")} × ${rupiah(sale.unitPrice)})`).join("; ")}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 sm:max-w-56">
                <span className="text-xs font-semibold text-slate-700">Harga jual</span>
                <MoneyInput
                  value={prices[row.id]}
                  min={0}
                  disabled={busy !== null}
                  onValueChange={(value) => setPrices((current) => ({ ...current, [row.id]: value }))}
                />
              </label>
              <Button className="min-h-11" disabled={busy !== null} onClick={() => decide(row, "approve")}>
                {busy === row.id ? "Menyimpan..." : "Setujui"}
              </Button>
              <Button className="min-h-11" variant="secondary" disabled={busy !== null} onClick={() => setRejecting(row)}>
                Tolak
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <ConfirmationModal
        isOpen={rejecting !== null}
        onClose={() => busy === null && setRejecting(null)}
        onConfirm={() => { if (rejecting) void decide(rejecting, "reject"); }}
        isLoading={busy !== null}
        variant="warning"
        title={`Tolak ${rejecting?.sku ?? "barang"}?`}
        description="Barang ini tidak masuk Master Barang. Penjualan yang sudah memakainya tetap tersimpan; bila salah barang, perbaiki penjualannya dari Riwayat Penjualan."
        confirmText="Ya, tolak"
      />
    </section>
  );
}

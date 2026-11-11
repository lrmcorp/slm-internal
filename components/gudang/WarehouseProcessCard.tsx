"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { useToast } from "@/components/ui/ToastProvider";

type Item = { id: string; sku: string; name: string; unit: string; requestedQty: number };
type Request = { id: string; requestNumber: string; fromName: string; toName: string; requestedByName: string; createdAt: string; notes: string | null; items: Item[] };
type Answer = { ok: boolean; qty: string; note: string };

const qtyText = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });
const timeLabel = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Satu permintaan barang di antrean Gudang, mirip proses DO:
 * centang bila barang ada sesuai permintaan, atau ketik jumlah yang benar-benar ada.
 */
export function WarehouseProcessCard({ request }: { request: Request }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const empty: Answer = { ok: false, qty: "", note: "" };
  const set = (id: string, patch: Partial<Answer>) => setAnswers((a) => ({ ...a, [id]: { ...empty, ...(a[id] ?? {}), ...patch } }));
  const fulfilledOf = (item: Item) => {
    const a = answers[item.id];
    if (!a) return null;
    if (a.ok) return item.requestedQty;
    if (a.qty.trim() === "") return null;
    const n = Number(a.qty.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };
  const values = request.items.map((item) => ({ item, fulfilled: fulfilledOf(item) }));
  const pending = values.filter((v) => v.fulfilled === null).length;
  const invalid = values.find((v) => Number.isNaN(v.fulfilled) || (v.fulfilled ?? 0) > v.item.requestedQty);
  const short = values.filter((v) => v.fulfilled !== null && !Number.isNaN(v.fulfilled) && v.fulfilled < v.item.requestedQty);

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch(`/api/gudang/requests/${request.id}/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: values.map((v) => ({ itemId: v.item.id, fulfilledQty: v.fulfilled, note: answers[v.item.id]?.note || undefined })) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) return showToast(json?.message || "Gagal menyimpan.", "error");
      showToast(json.data.complete ? `${request.requestNumber} selesai, stok sudah dipindah.` : `${request.requestNumber} tersimpan. Sales dan Super Admin dikabari barang yang kurang.`, "success");
      setConfirm(false);
      router.refresh();
    } catch {
      showToast("Koneksi terputus. Coba lagi.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="aj-surface overflow-hidden">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-3">
        <div>
          <p className="font-bold text-slate-900">{request.requestNumber} <span className="font-normal text-slate-500">· {request.requestedByName}</span></p>
          <p className="text-xs text-slate-600">{request.fromName} → {request.toName} · {timeLabel.format(new Date(request.createdAt))}</p>
        </div>
        <p className="text-xs font-semibold text-slate-600">{request.items.length - pending}/{request.items.length} dicek</p>
      </header>
      {request.notes && <p className="border-b border-slate-100 bg-amber-50 px-4 py-2 text-sm text-amber-900">Catatan sales: {request.notes}</p>}

      <ul className="divide-y divide-slate-100">
        {request.items.map((item) => {
          const a = answers[item.id];
          const f = fulfilledOf(item);
          const isShort = f !== null && !Number.isNaN(f) && f < item.requestedQty;
          return (
            <li key={item.id} className="px-4 py-3">
              <label className="flex min-h-11 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="h-6 w-6 shrink-0 accent-brand-600"
                  checked={Boolean(a?.ok)}
                  onChange={(e) => set(item.id, { ok: e.target.checked })}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-slate-900">{item.name}</span>
                  <span className="block text-xs text-slate-500">{item.sku}</span>
                </span>
                <span className="shrink-0 text-right font-bold tabular-nums text-slate-900">{qtyText(item.requestedQty)} {item.unit}</span>
              </label>
              {!a?.ok && (
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-9 text-sm">
                  <span className="text-slate-600">Tidak lengkap? Yang ada:</span>
                  <input
                    inputMode="decimal"
                    aria-label={`Jumlah ${item.name} yang ada`}
                    className="min-h-11 w-24 rounded-lg border border-slate-300 px-3 text-right tabular-nums"
                    placeholder="0"
                    value={a?.qty ?? ""}
                    onChange={(e) => set(item.id, { qty: e.target.value })}
                  />
                  <span className="text-slate-600">{item.unit}</span>
                </div>
              )}
              {isShort && (
                <input
                  aria-label={`Catatan kekurangan ${item.name}`}
                  className="ml-9 mt-2 min-h-11 w-[calc(100%-2.25rem)] rounded-lg border border-amber-300 bg-amber-50 px-3 text-sm"
                  placeholder="Catatan untuk sales, mis. stok habis, sisa di toko lain"
                  maxLength={300}
                  value={a?.note ?? ""}
                  onChange={(e) => set(item.id, { note: e.target.value })}
                />
              )}
            </li>
          );
        })}
      </ul>

      <footer className="border-t border-slate-100 px-4 py-3">
        {invalid && <p className="mb-2 text-sm text-rose-700">Jumlah {invalid.item.name} tidak boleh lebih dari yang diminta.</p>}
        <button
          type="button"
          disabled={pending > 0 || Boolean(invalid) || busy}
          onClick={() => setConfirm(true)}
          className="min-h-11 w-full rounded-lg bg-brand-700 px-4 text-sm font-bold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending > 0 ? `Cek ${pending} barang lagi` : `Selesai, kirim ke ${request.toName}`}
        </button>
      </footer>

      <ConfirmationModal
        isOpen={confirm}
        onClose={() => !busy && setConfirm(false)}
        onConfirm={submit}
        isLoading={busy}
        variant={short.length ? "warning" : "primary"}
        title={short.length ? `${short.length} barang kurang dari permintaan` : `Semua barang ${request.requestNumber} lengkap`}
        description={short.length
          ? <>Stok yang ada dipindah ke {request.toName}. Sales dan Super Admin akan dikabari: {short.map((s) => `${s.item.name} ${qtyText(s.fulfilled ?? 0)}/${qtyText(s.item.requestedQty)} ${s.item.unit}`).join(", ")}.</>
          : <>Semua barang dipindah dari {request.fromName} ke {request.toName}.</>}
        confirmText="Ya, simpan"
      />
    </article>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useToast } from "@/components/ui/ToastProvider";

type Location = { id: string; name: string; type: string };
type Product = { id: string; sku: string; name: string; unit: string };

const field = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

/** Form sales: minta barang dari gudang ke toko. */
export function WarehouseRequestForm({ locations, products }: { locations: Location[]; products: Product[] }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [from, setFrom] = useState(locations.find((l) => l.type === "WAREHOUSE")?.id ?? locations[0]?.id ?? "");
  const [to, setTo] = useState(locations.find((l) => l.type === "STORE")?.id ?? locations[1]?.id ?? "");
  const [items, setItems] = useState<{ productId: string; quantity: string }[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const byId = new Map(products.map((p) => [p.id, p]));

  function addProduct(productId: string) {
    if (items.some((i) => i.productId === productId)) return showToast("Barang ini sudah ada di daftar.", "error");
    setItems([...items, { productId, quantity: "" }]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!items.length) return showToast("Tambahkan minimal satu barang.", "error");
    const bad = items.find((i) => !(Number(i.quantity.replace(",", ".")) > 0));
    if (bad) return showToast(`Isi qty ${byId.get(bad.productId)?.name ?? "barang"}.`, "error");
    setBusy(true);
    try {
      const res = await fetch("/api/gudang/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromLocationId: from, toLocationId: to, notes: notes || undefined, items: items.map((i) => ({ productId: i.productId, quantity: Number(i.quantity.replace(",", ".")) })) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) return showToast(json?.message || "Gagal mengirim permintaan.", "error");
      showToast(`Permintaan ${json.data.requestNumber} terkirim ke gudang.`, "success");
      setItems([]);
      setNotes("");
      router.refresh();
    } catch {
      showToast("Koneksi terputus. Coba lagi.", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="aj-surface space-y-4 p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm font-semibold text-slate-700">
          <span>Ambil dari</span>
          <select className={field} value={from} onChange={(e) => setFrom(e.target.value)}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm font-semibold text-slate-700">
          <span>Kirim ke</span>
          <select className={field} value={to} onChange={(e) => setTo(e.target.value)}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold text-slate-700">Barang</p>
        {items.length > 0 && (
          <ul className="mb-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {items.map((item, index) => {
              const p = byId.get(item.productId);
              return (
                <li key={item.productId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900">{p?.name}</p>
                    <p className="text-xs text-slate-500">{p?.sku}</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <span className="sr-only">Qty {p?.name}</span>
                    <input
                      inputMode="decimal"
                      className="min-h-11 w-24 rounded-lg border border-slate-300 px-3 text-right text-sm tabular-nums"
                      value={item.quantity}
                      placeholder="0"
                      onChange={(e) => setItems(items.map((it, i) => (i === index ? { ...it, quantity: e.target.value } : it)))}
                    />
                    <span className="w-12 text-slate-600">{p?.unit}</span>
                  </label>
                  <button type="button" onClick={() => setItems(items.filter((_, i) => i !== index))} className="min-h-11 px-2 text-sm font-semibold text-rose-700">Hapus</button>
                </li>
              );
            })}
          </ul>
        )}
        <SearchableSelect
          options={products.map((p) => ({ value: p.id, label: p.name, description: `${p.sku} · ${p.unit}` }))}
          onSelect={addProduct}
          placeholder="+ Tambah barang"
          searchPlaceholder="Cari kode / nama barang"
          buttonClassName="min-h-11"
        />
      </div>

      <label className="block space-y-1 text-sm font-semibold text-slate-700">
        <span>Catatan untuk gudang <span className="font-normal text-slate-500">(opsional)</span></span>
        <input className={field} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="mis. untuk pesanan Bu Ani, siapkan sebelum jam 2" />
      </label>

      <Button type="submit" className="min-h-11 px-5" disabled={busy}>{busy ? "Mengirim..." : "Kirim Permintaan ke Gudang"}</Button>
    </form>
  );
}

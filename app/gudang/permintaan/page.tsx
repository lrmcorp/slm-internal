import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { AddPanel } from "@/components/inventory/AddPanel";
import { InventoryActionButton } from "@/components/inventory/InventoryActionButton";
import { InventoryHeader } from "@/components/inventory/ui";
import { WarehouseRequestForm } from "@/components/gudang/WarehouseRequestForm";
import { can } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/auth/session";
import { jakartaDateKey } from "@/lib/date/jakarta";
import { listLocations, listProductOptions } from "@/lib/inventory/service";
import { listWarehouseRequests } from "@/lib/inventory/warehouseRequests";

export const dynamic = "force-dynamic";

const qty = (n: number | null) => (n ?? 0).toLocaleString("id-ID", { maximumFractionDigits: 2 });
const when = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const STATUS: Record<string, { label: string; cls: string }> = {
  MENUNGGU: { label: "Menunggu gudang", cls: "bg-slate-100 text-slate-700" },
  SELESAI: { label: "Lengkap", cls: "bg-brand-50 text-brand-800" },
  SEBAGIAN: { label: "Kurang", cls: "bg-amber-100 text-amber-900" },
  BATAL: { label: "Dibatalkan", cls: "bg-slate-100 text-slate-500" },
};

export default async function PermintaanBarangPage() {
  const user = await getCurrentUser();
  if (!can(user.role, "gudang.request.create")) redirect("/no-access");
  // Sales melihat permintaannya sendiri; Super Admin, Supervisor, Manager melihat semua.
  const seeAll = user.role === "OWNER" || user.role === "SUPERVISOR" || user.role === "MANAGER";
  const from = jakartaDateKey(new Date(Date.now() - 30 * 86_400_000));
  const [locations, products, requests] = await Promise.all([
    listLocations(),
    listProductOptions(),
    listWarehouseRequests({ requestedByUserId: seeAll ? undefined : user.id, from, take: 200 }),
  ]);

  return (
    <AppShell>
      <InventoryHeader title="Permintaan Barang ke Gudang" description="Minta barang dari gudang untuk dikirim ke toko. Petugas Gudang menyiapkan dan mencentang barangnya; bila ada yang kurang, Anda mendapat notifikasi beserta catatannya." />
      <AddPanel label="Buat Permintaan">
        <WarehouseRequestForm locations={locations.map((l) => ({ id: l.id, name: l.name, type: l.type }))} products={products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, unit: p.unit }))} />
      </AddPanel>

      <h3 className="mb-3 font-bold text-slate-800">{seeAll ? "Semua permintaan" : "Permintaan saya"} (30 hari terakhir)</h3>
      <ul className="space-y-3">
        {requests.map((r) => {
          const status = STATUS[r.status];
          const shortItems = r.items.filter((i) => i.fulfilledQty != null && i.fulfilledQty < i.requestedQty);
          return (
            <li key={r.id} className={`aj-surface px-4 py-3 ${r.status === "SEBAGIAN" ? "border-amber-300" : ""}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-slate-900">{r.requestNumber} <span className="text-sm font-normal text-slate-500">· {when.format(new Date(r.createdAt))}{seeAll ? ` · ${r.requestedByName}` : ""}</span></p>
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${status.cls}`}>{status.label}</span>
              </div>
              <p className="text-xs text-slate-600">{r.fromName} → {r.toName}{r.processedByName ? ` · diproses ${r.processedByName}` : ""}</p>
              <table className="mt-2 w-full text-sm">
                <thead className="text-left text-xs text-slate-500"><tr><th className="py-1 font-medium">Barang</th><th className="py-1 text-right font-medium">Diminta</th><th className="py-1 text-right font-medium">Dikirim</th></tr></thead>
                <tbody>
                  {r.items.map((i) => {
                    const short = i.fulfilledQty != null && i.fulfilledQty < i.requestedQty;
                    return (
                      <tr key={i.id} className="border-t border-slate-100 align-top">
                        <td className="py-1.5 pr-2">{i.name}{i.note && <span className="block text-xs text-amber-900">Gudang: {i.note}</span>}</td>
                        <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{qty(i.requestedQty)} {i.unit}</td>
                        <td className={`whitespace-nowrap py-1.5 text-right tabular-nums ${short ? "font-bold text-amber-900" : ""}`}>{i.fulfilledQty == null ? "-" : `${qty(i.fulfilledQty)} ${i.unit}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {shortItems.length > 0 && <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900">Kurang {shortItems.length} barang. Sampaikan ke pembeli atau minta lagi saat stok ada.</p>}
              {r.notes && <p className="mt-1 text-xs text-slate-500">Catatan: {r.notes}</p>}
              {r.cancelReason && <p className="mt-1 text-xs text-slate-500">Alasan batal: {r.cancelReason}</p>}
              {r.status === "MENUNGGU" && (seeAll || r.requestedByUserId === user.id) && (
                <div className="mt-2">
                  <InventoryActionButton endpoint={`/api/gudang/requests/${r.id}/cancel`} label="Batalkan" askReason variant="danger" title={`Batalkan ${r.requestNumber}?`} description="Gudang tidak akan menyiapkan barang untuk permintaan ini." />
                </div>
              )}
            </li>
          );
        })}
        {!requests.length && <li className="aj-surface px-4 py-8 text-center text-sm text-slate-500">Belum ada permintaan. Klik Buat Permintaan untuk meminta barang dari gudang.</li>}
      </ul>
    </AppShell>
  );
}

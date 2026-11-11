import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { InventoryHeader } from "@/components/inventory/ui";
import { WarehouseProcessCard } from "@/components/gudang/WarehouseProcessCard";
import { can, primaryRole } from "@/lib/auth/roles";
import { getCurrentRole } from "@/lib/auth/session";
import { jakartaDateKey } from "@/lib/date/jakarta";
import { listWarehouseRequests } from "@/lib/inventory/warehouseRequests";

export const dynamic = "force-dynamic";

const qty = (n: number | null) => (n ?? 0).toLocaleString("id-ID", { maximumFractionDigits: 2 });
const time = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });

export default async function GudangPage() {
  const access = await getCurrentRole();
  const role = primaryRole(access);
  if (!can(access, "gudang.request.process")) redirect("/no-access");
  const today = jakartaDateKey();
  const [waiting, done] = await Promise.all([
    listWarehouseRequests({ status: ["MENUNGGU"], order: "asc", take: 50 }),
    listWarehouseRequests({ status: ["SELESAI", "SEBAGIAN"], from: today, to: today, take: 50 }),
  ]);

  return (
    <AppShell>
      <InventoryHeader
        title="Permintaan Barang Gudang"
        description="Siapkan barang yang diminta sales. Centang bila barang ada sesuai permintaan; bila kurang, isi jumlah yang ada. Setelah selesai, stok otomatis pindah ke toko."
      />
      <section className="mb-8">
        <h3 className="mb-3 font-bold text-slate-800">Perlu disiapkan ({waiting.length})</h3>
        <div className="space-y-4">
          {waiting.map((r) => <WarehouseProcessCard key={r.id} request={r} />)}
          {!waiting.length && <p className="aj-surface px-4 py-8 text-center text-sm text-slate-500">Tidak ada permintaan yang menunggu. Permintaan baru dari sales muncul di sini dan dikabari lewat notifikasi.</p>}
        </div>
      </section>

      <section>
        <h3 className="mb-3 font-bold text-slate-800">Selesai hari ini ({done.length})</h3>
        <ul className="aj-surface divide-y divide-slate-100">
          {done.map((r) => (
            <li key={r.id} className="px-4 py-2.5 text-sm">
              <p><span className="font-semibold text-slate-900">{r.requestNumber}</span> <span className="text-slate-500">· {r.requestedByName} · {r.processedAt ? time.format(new Date(r.processedAt)) : ""}</span>{r.status === "SEBAGIAN" && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">Kurang</span>}</p>
              <p className="text-xs text-slate-600">{r.items.map((i) => `${i.name} ${qty(i.fulfilledQty)}/${qty(i.requestedQty)} ${i.unit}`).join(" · ")}</p>
            </li>
          ))}
          {!done.length && <li className="px-4 py-6 text-center text-sm text-slate-500">Belum ada yang selesai hari ini.</li>}
        </ul>
      </section>
    </AppShell>
  );
}

import { primaryRole } from "@/lib/auth/roles";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { getCurrentRole } from "@/lib/auth/session";
import { jakartaDateKey } from "@/lib/date/jakarta";
import { getConsignmentReport } from "@/lib/reports/consignmentReport";

export const dynamic = "force-dynamic";

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const qty = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });
const dayLabel = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", weekday: "long", day: "2-digit", month: "short", year: "numeric" });
const timeLabel = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" });

export default async function ConsignmentReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; keyword?: string }> }) {
  // Laporan owner: angka rupiah hanya untuk Super Admin.
  if (primaryRole(await getCurrentRole()) !== "OWNER") redirect("/no-access");
  const p = await searchParams;
  const today = jakartaDateKey(new Date());
  const valid = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const from = valid(p.from) ?? `${today.slice(0, 7)}-01`;
  const to = valid(p.to) ?? today;
  const report = await getConsignmentReport({ from, to, keyword: p.keyword });
  const input = "min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

  return (
    <AppShell>
      <div className="mb-5">
        <h2 className="aj-page-title text-3xl font-bold">Laporan Consignment</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Barang yang terjual saat stoknya kosong. Qty yang tercatat hanya bagian yang melebihi stok saat itu. Stok lokasinya menjadi minus sampai barang masuk atau opname.
        </p>
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold text-slate-700">Dari<input type="date" name="from" defaultValue={from} className={`${input} mt-1 block`} /></label>
        <label className="text-xs font-semibold text-slate-700">Sampai<input type="date" name="to" defaultValue={to} className={`${input} mt-1 block`} /></label>
        <label className="min-w-48 flex-1 text-xs font-semibold text-slate-700">Cari<input name="keyword" defaultValue={p.keyword} placeholder="Kode / nama barang, customer, no transaksi" className={`${input} mt-1 block w-full`} /></label>
        <button className="min-h-10 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white">Terapkan</button>
      </form>

      <section className="aj-surface">
        <p className="border-b border-slate-200 px-4 py-3 text-sm text-slate-700">
          {report.products.length} barang · {qty(report.products.reduce((sum, x) => sum + x.quantity, 0))} satuan dari {report.totals.notaCount} nota · <b>{rupiah(report.totals.total)}</b>
        </p>
        {/* Per barang: qty terbanyak di atas. Buka untuk melihat nota yang menjualnya. */}
        <div className="divide-y divide-slate-100">
          {report.products.map((item) => (
            <details key={item.sku} className="group">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="flex min-w-0 items-baseline">
                    <span className="mr-1.5 inline-block shrink-0 text-slate-400 transition-transform group-open:rotate-90">›</span>
                    <span className="truncate font-semibold text-slate-900">{item.name}</span>
                  </span>
                  <span className="block pl-3.5 text-xs text-slate-500"><span className="font-mono">{item.sku}</span> · {item.notaCount} nota · terakhir {dayLabel.format(new Date(item.lastSoldAt.length > 10 ? item.lastSoldAt : `${item.lastSoldAt}T00:00:00+07:00`))}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-bold tabular-nums text-slate-900">{qty(item.quantity)} {item.unit}</span>
                  <span className="block text-xs tabular-nums text-slate-600">{rupiah(item.total)}</span>
                </span>
              </summary>
              <ul className="divide-y divide-slate-100 bg-slate-50/60 px-4 pb-2 pl-8 text-xs text-slate-600">
                {item.sales.map((s, i) => (
                  <li key={`${s.saleId ?? "x"}-${i}`} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0">
                      <span className="block truncate">
                        {s.transactionAt ? `${dayLabel.format(new Date(s.transactionAt))} ${timeLabel.format(new Date(s.transactionAt))}` : dayLabel.format(new Date(`${s.saleDate}T00:00:00+07:00`))} · {s.customerName}
                      </span>
                      <span className="block truncate text-slate-500">
                        {s.saleId
                          ? <Link href={`/penjualan/${s.saleId}`} className="font-semibold text-brand-800 underline">{s.transactionNumber ?? "Detail nota"}</Link>
                          : s.transactionNumber ?? "-"}
                        {" "}· {s.location} · {qty(s.quantity)} × {rupiah(s.unitPrice)}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">{rupiah(s.amount)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
          {!report.products.length && <p className="px-4 py-8 text-center text-sm text-slate-500">Tidak ada penjualan barang tanpa stok di periode ini.</p>}
        </div>
      </section>
    </AppShell>
  );
}

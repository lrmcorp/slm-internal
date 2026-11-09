import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { InventoryHeader, fmtQty } from "@/components/inventory/ui";
import { can } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/auth/session";
import { jakartaDateKey } from "@/lib/date/jakarta";
import { salesRecordScopeForUser } from "@/lib/sales/access";
import { getGoodsOutReport } from "@/lib/reports/goodsOut";

export const dynamic = "force-dynamic";

type SP = Promise<{ from?: string; to?: string; q?: string }>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// 16px di HP supaya Safari tidak memperbesar halaman saat kolom disentuh.
const field = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base sm:w-auto sm:text-sm";

function rupiah(value: number) {
  return `Rp${Math.round(value).toLocaleString("id-ID")}`;
}

function shortDate(key: string) {
  return new Date(`${key}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

function addDays(key: string, days: number) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function periodLabel(from: string, to: string) {
  const fmt = (key: string) => new Date(`${key}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
}

export default async function BarangKeluarPage({ searchParams }: { searchParams: SP }) {
  const user = await getCurrentUser();
  if (!can(user.role, "penjualan.create") && !can(user.role, "reports.view")) redirect("/no-access");

  const p = await searchParams;
  const today = jakartaDateKey();
  const monthStart = `${today.slice(0, 8)}01`;
  const from = p.from && DATE.test(p.from) ? p.from : monthStart;
  const to = p.to && DATE.test(p.to) ? p.to : today;
  const q = p.q?.trim() ?? "";
  const showNumber = user.role === "OWNER";

  const report = await getGoodsOutReport({ from, to, keyword: q, scope: salesRecordScopeForUser(user) });

  const presets = [
    { label: "Hari ini", from: today, to: today },
    { label: "7 hari", from: addDays(today, -6), to: today },
    { label: "Bulan ini", from: monthStart, to: today },
  ];
  const presetHref = (preset: { from: string; to: string }) => {
    const params = new URLSearchParams({ from: preset.from, to: preset.to, ...(q ? { q } : {}) });
    return `/inventory/barang-keluar?${params.toString()}`;
  };

  return (
    <AppShell>
      <InventoryHeader
        title="Barang Keluar"
        description="Barang yang terjual dalam periode ini: siapa pembelinya, di nota mana, dan berapa nilainya. Klik barang untuk melihat rinciannya."
      />

      <section className="aj-surface mb-5 p-4 sm:p-5">
        <div className="flex flex-wrap gap-2" aria-label="Periode cepat">
          {presets.map((preset) => {
            const active = preset.from === from && preset.to === to;
            return (
              <Link
                key={preset.label}
                href={presetHref(preset)}
                aria-current={active ? "true" : undefined}
                className={`inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-semibold ${active ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-brand-400 hover:bg-brand-50"}`}
              >
                {preset.label}
              </Link>
            );
          })}
        </div>
        <form className="mt-4 grid gap-3 sm:flex sm:flex-wrap sm:items-end">
          <label className="text-sm font-medium text-slate-700">Dari<input type="date" name="from" defaultValue={from} className={`${field} mt-1 block`} /></label>
          <label className="text-sm font-medium text-slate-700">Sampai<input type="date" name="to" defaultValue={to} className={`${field} mt-1 block`} /></label>
          <label className="text-sm font-medium text-slate-700 sm:min-w-64 sm:flex-1">Barang<input name="q" defaultValue={q} placeholder="Kode atau nama barang" className={`${field} mt-1 block sm:w-full`} /></label>
          <button className="min-h-11 rounded-lg bg-brand-700 px-5 text-sm font-semibold text-white hover:bg-brand-800">Tampilkan</button>
        </form>
      </section>

      <section className="aj-surface mb-5 grid grid-cols-2 sm:grid-cols-3">
        <div className="col-span-2 border-b border-slate-100 p-4 sm:col-span-1 sm:border-b-0 sm:border-r sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nilai terjual</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-950">{rupiah(report.totals.amount)}</p>
          <p className="mt-1 text-xs text-slate-500">{periodLabel(from, to)}</p>
        </div>
        <div className="border-r border-slate-100 p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nota</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-950">{report.totals.invoiceCount.toLocaleString("id-ID")}</p>
        </div>
        <div className="p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Jenis barang</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-slate-950">{report.totals.itemCount.toLocaleString("id-ID")}</p>
        </div>
      </section>

      <section className="aj-surface">
        <div className="hidden grid-cols-[minmax(0,1fr)_7rem_9rem_9rem_1.5rem] gap-3 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 md:grid">
          <span>Barang</span><span className="text-right">Qty</span><span className="text-right">Pembeli · Nota</span><span className="text-right">Nilai</span><span />
        </div>
        {report.items.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            {q ? `Tidak ada penjualan untuk "${q}" di periode ini.` : "Belum ada barang terjual di periode ini."}
          </p>
        )}
        <ul className="divide-y divide-slate-100">
          {report.items.map((item) => (
            <li key={item.sku}>
              <details className="group">
                <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 hover:bg-brand-50/60 md:grid-cols-[minmax(0,1fr)_7rem_9rem_9rem_1.5rem] md:items-center md:px-5 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-slate-950">{item.name ?? item.sku}</span>
                    {item.name && <span className="block font-mono text-xs text-slate-500">{item.sku}</span>}
                  </span>
                  <span className="text-right font-bold tabular-nums text-slate-950 md:order-4">{rupiah(item.amount)}</span>
                  <span className="text-sm tabular-nums text-slate-700 md:order-2 md:text-right">{fmtQty(item.quantity)} {item.unit}</span>
                  <span className="text-right text-sm text-slate-600 md:order-3">
                    {item.buyerCount} pembeli · {item.invoiceCount} nota
                    <span aria-hidden className="ml-1.5 inline-block text-slate-400 transition-transform group-open:rotate-180 md:hidden">⌄</span>
                  </span>
                  <span aria-hidden className="hidden text-slate-400 transition-transform group-open:rotate-180 md:order-5 md:block">⌄</span>
                </summary>
                <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-3 md:px-5">
                  <table className="hidden w-full text-sm md:table">
                    <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr><th className="py-1.5 pr-3 font-semibold">Tanggal</th><th className="py-1.5 pr-3 font-semibold">Nota</th><th className="py-1.5 pr-3 font-semibold">Pembeli</th><th className="py-1.5 pr-3 text-right font-semibold">Qty</th><th className="py-1.5 pr-3 text-right font-semibold">Harga</th><th className="py-1.5 text-right font-semibold">Subtotal</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70">
                      {item.lines.map((line, index) => (
                        <tr key={`${line.saleId}-${index}`}>
                          <td className="whitespace-nowrap py-2 pr-3 text-slate-600">{shortDate(line.saleDate)}</td>
                          <td className="py-2 pr-3"><Link href={`/penjualan/${line.saleId}`} className="font-semibold text-brand-700 underline-offset-2 hover:underline">{showNumber && line.transactionNumber ? line.transactionNumber : "Lihat nota"}</Link></td>
                          <td className="py-2 pr-3 text-slate-800">{line.customerName}{line.isMj && <span className="ml-1.5 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">MJ</span>}</td>
                          <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">{fmtQty(line.quantity)} {line.unit}</td>
                          <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums text-slate-600">{rupiah(line.unitPrice)}</td>
                          <td className="whitespace-nowrap py-2 text-right font-semibold tabular-nums">{rupiah(line.subtotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <ul className="space-y-2 md:hidden">
                    {item.lines.map((line, index) => (
                      <li key={`${line.saleId}-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-900">{line.customerName}{line.isMj && <span className="ml-1.5 rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">MJ</span>}</p>
                            <p className="text-xs text-slate-500">{shortDate(line.saleDate)} · {fmtQty(line.quantity)} {line.unit} × {rupiah(line.unitPrice)}</p>
                          </div>
                          <p className="shrink-0 font-semibold tabular-nums">{rupiah(line.subtotal)}</p>
                        </div>
                        <Link href={`/penjualan/${line.saleId}`} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brand-700">
                          {showNumber && line.transactionNumber ? `Nota ${line.transactionNumber}` : "Lihat nota"} →
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}

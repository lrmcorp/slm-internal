import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { InventoryHeader } from "@/components/inventory/ui";
import { can } from "@/lib/auth/roles";
import { getCurrentRole } from "@/lib/auth/session";
import { jakartaDateKey, jakartaMonthKey } from "@/lib/date/jakarta";
import { warehouseShortageReport } from "@/lib/inventory/warehouseRequests";

export const dynamic = "force-dynamic";

const qty = (n: number | null) => (n ?? 0).toLocaleString("id-ID", { maximumFractionDigits: 2 });
const when = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const valid = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export default async function LaporanSelisihGudangPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const role = await getCurrentRole();
  if (!can(role, "gudang.report.view")) redirect("/no-access");
  const p = await searchParams;
  const from = valid(p.from) ?? `${jakartaMonthKey()}-01`;
  const to = valid(p.to) ?? jakartaDateKey();
  const report = await warehouseShortageReport({ from, to });
  const input = "min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
  const rate = report.summary.processed ? Math.round((report.summary.complete / report.summary.processed) * 100) : null;

  return (
    <AppShell>
      <InventoryHeader title="Laporan Selisih Permintaan Gudang" description="Barang yang diminta sales tetapi dikirim gudang kurang dari permintaan. Pakai untuk mengecek stok gudang dan barang yang perlu dipesan ulang." />
      <form className="mb-5 flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold text-slate-700">Dari<input type="date" name="from" defaultValue={from} className={`${input} mt-1 block`} /></label>
        <label className="text-xs font-semibold text-slate-700">Sampai<input type="date" name="to" defaultValue={to} className={`${input} mt-1 block`} /></label>
        <button className="min-h-11 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white">Terapkan</button>
      </form>

      <p className="mb-5 text-sm text-slate-700">
        {report.summary.processed
          ? <>Dari <b>{report.summary.processed}</b> permintaan yang diproses, <b>{report.summary.complete}</b> lengkap{rate !== null ? ` (${rate}%)` : ""} dan <b className="text-amber-900">{report.summary.partial}</b> kurang, dengan <b>{report.summary.shortLines}</b> baris barang tidak sesuai.</>
          : "Belum ada permintaan yang diproses gudang di periode ini."}
      </p>

      <section className="aj-surface mb-6 overflow-x-auto">
        <h3 className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">Barang yang paling sering kurang</h3>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className="px-4 py-2">Barang</th><th className="px-4 py-2 text-right">Kali kurang</th><th className="px-4 py-2 text-right">Diminta</th><th className="px-4 py-2 text-right">Dikirim</th><th className="px-4 py-2 text-right">Kurang</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {report.products.map((r) => (
              <tr key={r.sku}>
                <td className="px-4 py-2"><span className="font-mono text-xs text-slate-500">{r.sku}</span> {r.name}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.times}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{qty(r.requested)} {r.unit}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{qty(r.fulfilled)} {r.unit}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums text-amber-900">{qty(r.short)} {r.unit}</td>
              </tr>
            ))}
            {!report.products.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">Semua permintaan di periode ini dikirim lengkap.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="aj-surface overflow-x-auto">
        <h3 className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">Rincian per permintaan</h3>
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600"><tr><th className="px-4 py-2">Permintaan</th><th className="px-4 py-2">Barang</th><th className="px-4 py-2 text-right">Diminta</th><th className="px-4 py-2 text-right">Dikirim</th><th className="px-4 py-2">Catatan gudang</th><th className="px-4 py-2">Sales / Gudang</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {report.lines.map((l) => (
              <tr key={l.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-2"><span className="font-semibold">{l.requestNumber}</span><span className="block text-xs text-slate-500">{l.processedAt ? when.format(new Date(l.processedAt)) : ""}</span></td>
                <td className="px-4 py-2">{l.name}<span className="block font-mono text-xs text-slate-500">{l.sku}</span></td>
                <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{qty(l.requestedQty)} {l.unit}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums text-amber-900">{qty(l.fulfilledQty)} {l.unit}</td>
                <td className="px-4 py-2 text-xs text-slate-700">{l.note || "-"}</td>
                <td className="px-4 py-2 text-xs">{l.requestedByName}<span className="block text-slate-500">{l.processedByName ?? "-"}</span></td>
              </tr>
            ))}
            {!report.lines.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Tidak ada selisih.</td></tr>}
          </tbody>
        </table>
      </section>
      <p className="mt-4 text-xs text-slate-500">Semua permintaan dan statusnya ada di <Link href="/gudang/permintaan" className="font-semibold text-brand-800 underline">Permintaan Barang</Link>.</p>
    </AppShell>
  );
}

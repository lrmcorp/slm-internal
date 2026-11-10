import { AppShell } from "@/components/layout/AppShell";
import { requirePermission } from "@/lib/auth/requirePermission";
import { AddPanel } from "@/components/inventory/AddPanel";
import { InventoryActionButton } from "@/components/inventory/InventoryActionButton";
import { CashBankForm } from "@/components/finance/CashBankForm";
import { CASH_BANK_TYPES, cashBankBalances, listCashBankMutations } from "@/lib/accounting/cashBank";
import { jakartaDateKey, formatJakartaDate } from "@/lib/date/jakarta";

export const dynamic = "force-dynamic";

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export default async function CashBankPage() {
  await requirePermission("cashbank.manage");
  const [balances, mutations] = await Promise.all([cashBankBalances(), listCashBankMutations()]);
  const showGeneral = Math.abs(balances.general.balance) >= 1;
  const rekeningOptions = [
    ...balances.rekenings.map((r) => ({ id: r.id, label: r.name })),
    ...(showGeneral ? [{ id: balances.general.id, label: balances.general.name }] : [])
  ];
  const types = Object.entries(CASH_BANK_TYPES).map(([value, t]) => ({
    value, label: t.label, from: t.from, to: t.to,
    fromHint: "fromHint" in t ? t.fromHint : undefined, toHint: "toHint" in t ? t.toHint : undefined
  }));

  return (
    <AppShell>
      <div className="mb-6">
        <h2 className="aj-page-title text-3xl font-bold">Mutasi Kas &amp; Bank</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-600">
          Catat uang yang pindah tanpa lewat penjualan atau pengeluaran: setor tunai, tarik tunai, pindah dana antar rekening, biaya admin, bunga, setoran modal, dan prive. Jurnalnya dibuat otomatis.
        </p>
      </div>

      <AddPanel label="Catat Mutasi">
        <CashBankForm types={types} rekenings={rekeningOptions} today={jakartaDateKey()} />
      </AddPanel>

      <section className="mb-8">
        <h3 className="mb-3 font-bold text-slate-800">Saldo per rekening</h3>
        <div className="aj-surface overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr><th className="px-3 py-2">Rekening</th><th className="px-3 py-2">Akun</th><th className="px-3 py-2 text-right">Saldo buku</th></tr>
            </thead>
            <tbody>
              {balances.rekenings.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold text-slate-900">{r.name}{r.currency !== "IDR" && <span className="ml-1 text-xs font-normal text-slate-500">({r.currency})</span>}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{r.accountCode ?? "-"}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${r.balance < 0 ? "text-red-800" : ""}`}>{rupiah(r.balance)}</td>
                </tr>
              ))}
              {showGeneral && (
                <tr className="border-t border-slate-100">
                  <td className="px-3 py-2 text-slate-700">{balances.general.name}<div className="text-xs text-slate-500">Transaksi sebelum tiap rekening punya akun sendiri. Pindahkan ke rekening yang benar lewat &quot;Pindah dana antar rekening&quot;.</div></td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{balances.general.accountCode}</td>
                  <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${balances.general.balance < 0 ? "text-red-800" : ""}`}>{rupiah(balances.general.balance)}</td>
                </tr>
              )}
              {!balances.rekenings.length && <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-500">Belum ada rekening. Tambahkan di Pengaturan &gt; Rekening.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-3 font-bold text-slate-800">Riwayat mutasi</h3>
        <div className="aj-surface overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr><th className="px-3 py-2">Tanggal</th><th className="px-3 py-2">Jenis</th><th className="px-3 py-2">Dari → Ke</th><th className="px-3 py-2 text-right">Nominal</th><th className="px-3 py-2">Oleh</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {mutations.map((m) => (
                <tr key={m.id} className={`border-t border-slate-100 align-top ${m.cancelled ? "text-slate-400" : ""}`}>
                  <td className="whitespace-nowrap px-3 py-2">{formatJakartaDate(m.date)}<div className="font-mono text-xs text-slate-500">{m.journalNumber}</div></td>
                  <td className="px-3 py-2">{m.typeLabel}{m.cancelled && <div className="text-xs font-semibold text-red-800">Dibatalkan</div>}</td>
                  <td className="px-3 py-2">{[m.from, m.to].filter(Boolean).join(" → ") || "-"}{m.description.includes(" · ") && <div className="text-xs text-slate-500">{m.description.split(" · ").slice(1).join(" · ")}</div>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{rupiah(m.amount)}</td>
                  <td className="px-3 py-2 text-xs">{m.createdBy}</td>
                  <td className="px-3 py-2">
                    {!m.cancelled && <InventoryActionButton endpoint={`/api/cash-bank/${m.id}/cancel`} label="Batalkan" askReason variant="danger" title={`Batalkan ${m.typeLabel.toLowerCase()} ${rupiah(m.amount)}?`} description="Jurnal pembalik dibuat dengan tanggal hari ini, jadi saldo rekening kembali seperti sebelum mutasi ini." />}
                  </td>
                </tr>
              ))}
              {!mutations.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Belum ada mutasi. Klik Catat Mutasi untuk mencatat setoran, penarikan, atau biaya bank.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}

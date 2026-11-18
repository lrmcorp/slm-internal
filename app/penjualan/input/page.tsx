import { AppShell } from "@/components/layout/AppShell";
import { isLocalInventory } from "@/lib/inventory/config";
import { PenjualanForm } from "@/components/forms/PenjualanForm";
import {
  listBookkeepingTypes,
  listRekeningAccounts,
} from "@/lib/business/masterData";
import { requirePermission } from "@/lib/auth/requirePermission";
import { getCurrentUser } from "@/lib/auth/session";
import { erpSalesTypeCodes } from "@/lib/api/sales";
import { getSalesRecord } from "@/lib/sales/store";
import { saleForCopy } from "@/lib/sales/copy";

export const dynamic = "force-dynamic";

export default async function InputPenjualanPage({
  searchParams,
}: {
  searchParams?: Promise<{ copyFrom?: string }>;
}) {
  await requirePermission("penjualan.create");
  // Tombol Salin di Riwayat Penjualan: barang ikut, data customer diisi ulang.
  const copyFromId = (await searchParams)?.copyFrom;
  const [tipes, rekenings, user, copySource] = await Promise.all([
    listBookkeepingTypes(),
    listRekeningAccounts(),
    getCurrentUser(),
    copyFromId ? getSalesRecord(copyFromId) : Promise.resolve(undefined),
  ]);
  const copiedSale = copySource && copySource.items.length ? await saleForCopy(copySource) : undefined;
  return (
    <AppShell>
      <div className="mb-7">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.13em] text-brand-600">
          Transaksi
        </p>
        <h2 className="aj-page-title text-3xl font-bold">Input Penjualan</h2>
        <p className="mt-2 text-sm text-slate-600">
          {copiedSale
            ? "Barang disalin dari transaksi lain. Isi data customer, lalu periksa jumlah dan harganya."
            : "Masukkan transaksi penjualan dan barang yang dijual."}
        </p>
      </div>
      <PenjualanForm
        tipes={tipes}
        rekenings={rekenings}
        allowTestTransaction={user.role === "OWNER"}
        erpTypeCodes={Array.from(erpSalesTypeCodes())}
        localCatalog={isLocalInventory()}
        copiedSale={copiedSale}
      />
    </AppShell>
  );
}

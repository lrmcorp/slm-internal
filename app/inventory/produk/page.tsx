import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { ProductCreateForm } from "@/components/inventory/ProductCreateForm";
import { ProductTable } from "@/components/inventory/ProductTable";
import { RmbRateForm } from "@/components/inventory/RmbRateForm";
import { CbmRateForm } from "@/components/inventory/CbmRateForm";
import Link from "next/link";
import { BulkUnitForm } from "@/components/inventory/BulkUnitForm";
import { AddPanel, SettingsPanel } from "@/components/inventory/AddPanel";
import { InventoryHeader, Pager, filterButton, filterInput } from "@/components/inventory/ui";
import { can, primaryRole } from "@/lib/auth/roles";
import { getCurrentRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getCbmRate, getRmbRate } from "@/lib/inventory/pricing";
import { listLocations, listProducts, listUnitUsage } from "@/lib/inventory/service";

export const dynamic = "force-dynamic";

export default async function InventoryProductPage({ searchParams }: { searchParams: Promise<{ keyword?: string; page?: string; edit?: string }> }) {
  const access = await getCurrentRole();
  const role = primaryRole(access);
  if (!can(access, "inventory.master")) redirect("/no-access");
  const p = await searchParams;
  const canManage = can(access, "inventory.master");
  const canCosting = can(access, "inventory.costing");
  const [locations, result, rmb, rmbProducts, units, cbm] = await Promise.all([
    listLocations(),
    listProducts({ keyword: p.keyword, page: Number(p.page) || 1, pageSize: 50 }),
    getRmbRate(),
    prisma.inventoryProduct.count({ where: { priceRmb: { not: null } } }),
    listUnitUsage(),
    getCbmRate()
  ]);
  return (
    <AppShell>
      <InventoryHeader title="Master Barang" description={<>Atur isi per koli, harga RMB, modal, dan harga jual tiap barang.{canCosting && <> Barang dari supplier bisa masuk lewat <Link className="text-brand-800 underline" href="/inventory/packing-list">Import Packing List</Link>. Hitung modal cepat di <Link className="text-brand-800 underline" href="/inventory/kalkulator">Kalkulator</Link>.</>}</>} />
      {canManage && <AddPanel label="Tambah Barang"><ProductCreateForm locations={locations} /></AddPanel>}
      <SettingsPanel summary={<><span className="whitespace-nowrap">Kurs RMB</span> <b className="whitespace-nowrap">{rmb.rate ? `Rp ${rmb.rate.toLocaleString("id-ID")}` : "belum diatur"}</b> · <span className="whitespace-nowrap">Tarif CBM</span> <b className="whitespace-nowrap">{cbm.rate ? `Rp ${cbm.rate.toLocaleString("id-ID")}` : "belum diatur"}</b></>}>
        <RmbRateForm rate={rmb.rate} updatedAt={rmb.updatedAt} updatedBy={rmb.updatedBy} rmbProducts={rmbProducts} canManage={canManage} />
        <CbmRateForm rate={cbm.rate} updatedAt={cbm.updatedAt} updatedBy={cbm.updatedBy} canManage={canManage} />
        {canManage && units.length > 0 && <BulkUnitForm units={units} />}
      </SettingsPanel>
      <form className="mb-4 flex gap-2">
        <input name="keyword" defaultValue={p.keyword} placeholder="Cari SKU / nama / barcode" className={`${filterInput} w-full sm:w-72`} />
        <button className={filterButton}>Cari</button>
      </form>
      <ProductTable rows={result.data} rate={rmb.rate} cbmRate={cbm.rate} canManage={canManage} initialEditingId={p.edit} />
      <Pager basePath="/inventory/produk" params={{ keyword: p.keyword }} page={result.meta.page} totalPages={result.meta.totalPages} />
    </AppShell>
  );
}

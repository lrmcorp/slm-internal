import "server-only";
import { prisma } from "@/lib/db/prisma";
import { jakartaDateKey } from "@/lib/date/jakarta";
import { productNamesBySku } from "@/lib/inventory/catalog";
import { apakahPenjualanOperasional, hitungLabaNota, isTransaksiMj } from "@/lib/dashboard/summary";
import { buildSalesWhere, mjPriceBasisOf, type SalesRecordScope } from "@/lib/sales/store";
import type { Sale } from "@/lib/types/sales";

export type GoodsOutLine = {
  saleId: string;
  saleDate: string;
  transactionNumber: string | null;
  customerName: string;
  isMj: boolean;
  quantity: number;
  unit: string;
  /** Harga satuan bagian SLM (nota MJ lama sudah dibagi 1,1). */
  unitPrice: number;
  /** Nilai barang di nota: sama dengan omset dashboard (diskon nota dibagi proporsional). */
  subtotal: number;
};

export type GoodsOutItem = {
  sku: string;
  name: string | null;
  unit: string;
  quantity: number;
  amount: number;
  invoiceCount: number;
  buyerCount: number;
  lines: GoodsOutLine[];
};

/**
 * Pencocokan dengan total Riwayat Penjualan (nota tidak batal dan bukan draft) di periode yang sama:
 * riwayatTotal = notInReport.* + mjMarkup + goodsAmount + otherAmount.
 */
export type GoodsOutReconciliation = {
  riwayatTotal: number;
  riwayatCount: number;
  pendingApproval: { count: number; total: number };
  ajType: { count: number; total: number };
  testTransactions: { count: number; total: number };
  /** Nota MJ lama: Riwayat memakai harga MJ, Barang Keluar memakai bagian SLM (harga MJ / 1,1). */
  mjMarkup: { count: number; total: number };
  /** Selisih kecil nota lain antara total nota dan omset (pembulatan). */
  rounding: number;
  goodsAmount: number;
  otherAmount: number;
};

export type GoodsOutReport = {
  items: GoodsOutItem[];
  reconciliation?: GoodsOutReconciliation;
  totals: {
    quantityLines: number;
    /** Nilai barang terjual. */
    amount: number;
    /** Tagihan di luar barang (mis. ongkir) di nota yang sama; amount + otherAmount = omset dashboard. */
    otherAmount: number;
    invoiceCount: number;
    itemCount: number;
  };
};

/**
 * Barang yang keluar karena penjualan dalam periode: per barang, siapa pembelinya, di nota mana, berapa rupiah.
 * Nilainya memakai hitungan omset dashboard (hitungLabaNota) dan nota yang sama (disetujui, bukan tipe AJ),
 * jadi total laporan ini + biaya di luar barang = omset dashboard.
 */
export async function getGoodsOutReport(input: { from: string; to: string; keyword?: string; scope?: SalesRecordScope }): Promise<GoodsOutReport> {
  const keyword = input.keyword?.trim().toLowerCase() || "";
  const sales = await prisma.salesRecord.findMany({
    where: {
      AND: [buildSalesWhere({ from: input.from, to: input.to }, input.scope), { approvalStatus: "approved", isTestTransaction: false }],
    },
    select: {
      id: true, saleDate: true, transactionAt: true, transactionNumber: true, customerName: true, source: true, createdByUserId: true,
      tipeId: true, tipeCodeSnapshot: true, total: true, integrationMetadata: true,
      items: { orderBy: { sortOrder: "asc" }, select: { productRef: true, productId: true, manualProduct: true, quantity: true, unitPrice: true, discount: true, unitSnapshot: true } },
    },
    orderBy: [{ saleDate: "desc" }, { transactionAt: "desc" }],
  });

  const bySku = new Map<string, GoodsOutItem & { invoices: Set<string>; buyers: Set<string> }>();
  let otherAmount = 0;
  let mjMarkup = { count: 0, total: 0 };
  let rounding = 0;
  for (const row of sales) {
    const metadata = row.integrationMetadata && typeof row.integrationMetadata === "object" ? (row.integrationMetadata as Record<string, unknown>) : {};
    const sale = {
      source: row.source ?? undefined,
      createdByUserId: row.createdByUserId,
      tipeId: row.tipeId,
      tipeCodeSnapshot: row.tipeCodeSnapshot,
      total: Number(row.total) || 0,
      ...(mjPriceBasisOf(metadata) ? { mjPriceBasis: "slm" as const } : {}),
      items: row.items.map((item) => ({ ...item, productId: item.productId ?? undefined, quantity: Number(item.quantity) || 0, unitPrice: Number(item.unitPrice) || 0, discount: Number(item.discount) || 0 })),
    } as unknown as Sale;
    if (!apakahPenjualanOperasional(sale)) continue;

    const nota = hitungLabaNota(sale, 0, new Map());
    otherAmount += nota.omset - nota.items.reduce((sum, item) => sum + item.omset, 0);
    const markup = (Number(row.total) || 0) - nota.omset;
    if (isTransaksiMj(sale) && Math.abs(markup) >= 1) mjMarkup = { count: mjMarkup.count + 1, total: mjMarkup.total + markup };
    else rounding += markup;
    const isMj = isTransaksiMj(sale);
    const slmShare = isMj && sale.mjPriceBasis !== "slm" ? 1 / 1.1 : 1;

    row.items.forEach((item, index) => {
      const sku = item.productRef.trim();
      if (!sku) return;
      const quantity = Number(item.quantity) || 0;
      const subtotal = nota.items[index]?.omset ?? 0;
      const unit = item.unitSnapshot?.trim() || "Pcs";
      const key = sku.toLowerCase();
      let entry = bySku.get(key);
      if (!entry) {
        entry = { sku, name: null, unit, quantity: 0, amount: 0, invoiceCount: 0, buyerCount: 0, lines: [], invoices: new Set(), buyers: new Set() };
        bySku.set(key, entry);
      }
      entry.quantity += quantity;
      entry.amount += subtotal;
      entry.invoices.add(row.id);
      entry.buyers.add(row.customerName.trim().toLowerCase());
      entry.lines.push({
        saleId: row.id,
        saleDate: jakartaDateKey(row.transactionAt ?? row.saleDate),
        transactionNumber: row.transactionNumber,
        customerName: row.customerName,
        isMj,
        quantity,
        unit,
        unitPrice: Math.round((Number(item.unitPrice) || 0) * slmShare),
        subtotal,
      });
    });
  }

  const names = await productNamesBySku(Array.from(bySku.values()).map((entry) => entry.sku));
  let items: GoodsOutItem[] = Array.from(bySku.values()).map(({ invoices, buyers, ...entry }) => ({
    ...entry,
    name: names[entry.sku.toLowerCase()] ?? null,
    invoiceCount: invoices.size,
    buyerCount: buyers.size,
  }));
  const filtered = Boolean(keyword);
  if (filtered) items = items.filter((entry) => entry.sku.toLowerCase().includes(keyword) || (entry.name ?? "").toLowerCase().includes(keyword));
  items.sort((a, b) => b.amount - a.amount || b.quantity - a.quantity);

  // Pencocokan dengan Riwayat Penjualan (hanya bila semua barang ditampilkan).
  let reconciliation: GoodsOutReconciliation | undefined;
  if (!filtered) {
    const all = await prisma.salesRecord.findMany({
      where: { AND: [buildSalesWhere({ from: input.from, to: input.to }, input.scope), { approvalStatus: { notIn: ["draft", "cancelled"] } }] },
      select: { total: true, approvalStatus: true, isTestTransaction: true, tipeId: true, tipeCodeSnapshot: true, source: true, createdByUserId: true },
    });
    const bucket = () => ({ count: 0, total: 0 });
    const pendingApproval = bucket(), ajType = bucket(), testTransactions = bucket();
    let riwayatTotal = 0;
    for (const s of all) {
      const total = Number(s.total) || 0;
      riwayatTotal += total;
      const target = s.approvalStatus !== "approved" ? pendingApproval
        : s.isTestTransaction ? testTransactions
        : !apakahPenjualanOperasional({ tipeId: s.tipeId, tipeCodeSnapshot: s.tipeCodeSnapshot, source: s.source ?? undefined, createdByUserId: s.createdByUserId } as unknown as Sale) ? ajType
        : null;
      if (target) { target.count += 1; target.total += total; }
    }
    const goodsAmount = items.reduce((sum, entry) => sum + entry.amount, 0);
    reconciliation = { riwayatTotal, riwayatCount: all.length, pendingApproval, ajType, testTransactions, mjMarkup, rounding, goodsAmount, otherAmount };
  }

  return {
    items,
    reconciliation,
    totals: {
      quantityLines: items.reduce((sum, entry) => sum + entry.lines.length, 0),
      amount: items.reduce((sum, entry) => sum + entry.amount, 0),
      // Biaya di luar barang hanya relevan bila semua barang ditampilkan.
      otherAmount: filtered ? 0 : otherAmount,
      invoiceCount: new Set(items.flatMap((entry) => entry.lines.map((line) => line.saleId))).size,
      itemCount: items.length,
    },
  };
}

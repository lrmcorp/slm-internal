import "server-only";
import { prisma } from "@/lib/db/prisma";
import { jakartaDateKey } from "@/lib/date/jakarta";
import { productNamesBySku } from "@/lib/inventory/catalog";
import { buildSalesWhere, type SalesRecordScope } from "@/lib/sales/store";

export type GoodsOutLine = {
  saleId: string;
  saleDate: string;
  transactionNumber: string | null;
  customerName: string;
  isMj: boolean;
  quantity: number;
  unit: string;
  unitPrice: number;
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

export type GoodsOutReport = {
  items: GoodsOutItem[];
  totals: { quantityLines: number; amount: number; invoiceCount: number; itemCount: number };
};

/** Barang yang keluar karena penjualan dalam periode: per barang, siapa pembelinya, di nota mana, berapa rupiah. */
export async function getGoodsOutReport(input: { from: string; to: string; keyword?: string; scope?: SalesRecordScope }): Promise<GoodsOutReport> {
  const keyword = input.keyword?.trim().toLowerCase() || "";
  const sales = await prisma.salesRecord.findMany({
    where: {
      AND: [
        buildSalesWhere({ from: input.from, to: input.to }, input.scope),
        // Draft belum memotong stok; batal/ditolak sudah dikembalikan.
        { approvalStatus: { notIn: ["draft", "cancelled", "rejected"] }, isTestTransaction: false },
      ],
    },
    select: {
      id: true, saleDate: true, transactionAt: true, transactionNumber: true, customerName: true, source: true, createdByUserId: true,
      items: { select: { productRef: true, quantity: true, unitPrice: true, discount: true, unitSnapshot: true } },
    },
    orderBy: [{ saleDate: "desc" }, { transactionAt: "desc" }],
  });

  const bySku = new Map<string, GoodsOutItem & { invoices: Set<string>; buyers: Set<string> }>();
  for (const sale of sales) {
    const isMj = sale.source === "MJ" || sale.createdByUserId === "integration:mj";
    for (const item of sale.items) {
      const sku = item.productRef.trim();
      if (!sku) continue;
      const quantity = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      const subtotal = quantity * unitPrice - (Number(item.discount) || 0);
      const unit = item.unitSnapshot?.trim() || "Pcs";
      const key = sku.toLowerCase();
      let row = bySku.get(key);
      if (!row) {
        row = { sku, name: null, unit, quantity: 0, amount: 0, invoiceCount: 0, buyerCount: 0, lines: [], invoices: new Set(), buyers: new Set() };
        bySku.set(key, row);
      }
      row.quantity += quantity;
      row.amount += subtotal;
      row.invoices.add(sale.id);
      row.buyers.add(sale.customerName.trim().toLowerCase());
      row.lines.push({
        saleId: sale.id,
        saleDate: jakartaDateKey(sale.transactionAt ?? sale.saleDate),
        transactionNumber: sale.transactionNumber,
        customerName: sale.customerName,
        isMj,
        quantity,
        unit,
        unitPrice,
        subtotal,
      });
    }
  }

  const names = await productNamesBySku(Array.from(bySku.values()).map((row) => row.sku));
  let items: GoodsOutItem[] = Array.from(bySku.values()).map(({ invoices, buyers, ...row }) => ({
    ...row,
    name: names[row.sku.toLowerCase()] ?? null,
    invoiceCount: invoices.size,
    buyerCount: buyers.size,
  }));
  if (keyword) items = items.filter((row) => row.sku.toLowerCase().includes(keyword) || (row.name ?? "").toLowerCase().includes(keyword));
  items.sort((a, b) => b.amount - a.amount || b.quantity - a.quantity);

  return {
    items,
    totals: {
      quantityLines: items.reduce((sum, row) => sum + row.lines.length, 0),
      amount: items.reduce((sum, row) => sum + row.amount, 0),
      invoiceCount: new Set(items.flatMap((row) => row.lines.map((line) => line.saleId))).size,
      itemCount: items.length,
    },
  };
}

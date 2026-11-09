import "server-only";
import { prisma } from "@/lib/db/prisma";
import { PUSH_AUDIENCE, pushConfig } from "./config";
import { sendPushToRoles } from "./send";

function rupiah(value: number) {
  return `Rp${Math.round(value).toLocaleString("id-ID")}`;
}

function qty(value: number) {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

/**
 * Notifikasi "Penjualan baru" untuk nota yang sudah disetujui. Draft dan yang menunggu persetujuan dikirim
 * saat disetujui. Dipanggil setelah transaksi tersimpan; tidak pernah melempar error.
 */
export async function notifyNewSale(saleId: string) {
  if (!pushConfig().enabled) return;
  try {
    const sale = await prisma.salesRecord.findUnique({
      where: { id: saleId },
      select: { id: true, approvalStatus: true, isTestTransaction: true, total: true, customerName: true, paymentMethod: true, createdByNameSnapshot: true, source: true, createdByUserId: true, _count: { select: { items: true } } },
    });
    if (!sale || sale.approvalStatus !== "approved" || sale.isTestTransaction) return;
    const isMj = sale.source === "MJ" || sale.createdByUserId === "integration:mj";
    const parts = [sale.customerName, `${sale._count.items} barang`, sale.paymentMethod, isMj ? "dari MJ" : sale.createdByNameSnapshot ? `oleh ${sale.createdByNameSnapshot}` : ""].filter(Boolean);
    await sendPushToRoles(PUSH_AUDIENCE.newSale, {
      title: `Penjualan baru · ${rupiah(Number(sale.total) || 0)}`,
      body: parts.join(" · "),
      url: `/penjualan/${sale.id}`,
      tag: `sale-${sale.id}`,
    });
  } catch (error) {
    console.error("[push] notifikasi penjualan gagal:", error instanceof Error ? error.message : error);
  }
}

/** Batas stok minimum, sama dengan daftar stok: isi 1 koli bila ada, selain itu stok minimum. */
export function lowStockThreshold(product: { unitsPerKoli: number | null; minimumStock: number }) {
  if (product.unitsPerKoli && product.unitsPerKoli > 0) return product.unitsPerKoli;
  return product.minimumStock > 0 ? product.minimumStock : null;
}

/** Hanya saat stok baru turun melewati batas, bukan setiap pergerakan selama stok sudah di bawah batas. */
export function crossedLowStock(totalAfter: number, netDelta: number, threshold: number | null) {
  if (threshold == null || netDelta >= 0) return false;
  const before = totalAfter - netDelta;
  return before > threshold && totalAfter <= threshold;
}

/** Dipanggil setelah transaksi stok tersimpan, dengan perubahan bersih per barang di transaksi itu. */
export async function notifyLowStockCrossings(netDeltaByProduct: Map<string, number>) {
  if (!pushConfig().enabled || netDeltaByProduct.size === 0) return;
  try {
    const ids = Array.from(netDeltaByProduct.entries()).filter(([, delta]) => delta < 0).map(([id]) => id);
    if (ids.length === 0) return;
    const [products, totals] = await Promise.all([
      prisma.inventoryProduct.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, sku: true, name: true, unit: true, unitsPerKoli: true, minimumStock: true } }),
      prisma.inventoryBalance.groupBy({ by: ["productId"], where: { productId: { in: ids } }, _sum: { quantity: true } }),
    ]);
    const totalById = new Map(totals.map((row) => [row.productId, Number(row._sum.quantity ?? 0)]));
    for (const product of products) {
      const threshold = lowStockThreshold({ unitsPerKoli: product.unitsPerKoli == null ? null : Number(product.unitsPerKoli), minimumStock: Number(product.minimumStock) });
      const after = totalById.get(product.id) ?? 0;
      if (!crossedLowStock(after, netDeltaByProduct.get(product.id) ?? 0, threshold)) continue;
      const unit = product.unit || "Pcs";
      await sendPushToRoles(PUSH_AUDIENCE.lowStock, {
        title: `Stok minimum: ${product.name || product.sku}`,
        body: `Sisa ${qty(after)} ${unit} (batas ${qty(threshold ?? 0)} ${unit}) · ${product.sku}`,
        url: `/inventory?keyword=${encodeURIComponent(product.sku)}`,
        tag: `stock-${product.id}`,
      });
    }
  } catch (error) {
    console.error("[push] notifikasi stok gagal:", error instanceof Error ? error.message : error);
  }
}

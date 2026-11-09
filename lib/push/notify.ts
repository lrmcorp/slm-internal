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
 * Notifikasi "Transaksi Baru" setiap ada baris baru di Riwayat Penjualan (draft, menunggu persetujuan,
 * atau disetujui; juga nota dari MJ). Dipanggil sekali saat nota dibuat; tidak pernah melempar error.
 */
export async function notifyNewSale(saleId: string) {
  if (!pushConfig().enabled) return;
  try {
    const sale = await prisma.salesRecord.findUnique({
      where: { id: saleId },
      select: { id: true, isTestTransaction: true, total: true, customerName: true, customerLocation: true },
    });
    if (!sale || sale.isTestTransaction) return;
    const location = sale.customerLocation?.trim();
    await sendPushToRoles(PUSH_AUDIENCE.newSale, {
      title: "Transaksi Baru",
      body: `${rupiah(Number(sale.total) || 0)} dari ${sale.customerName}${location ? ` - ${location}` : ""}`,
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

/** Ringkasan harian Tempo (dikirim bersama pengingat tempo pukul 09.00): lewat jatuh tempo dan jatuh tempo ≤ 3 hari. */
export function tempoDueMessage(summary: { overdue: { count: number; amount: number }; comingSoonH3: { count: number; amount: number } }) {
  const parts = [
    summary.overdue.count > 0 ? `Lewat jatuh tempo: ${summary.overdue.count} nota ${rupiah(summary.overdue.amount)}` : null,
    summary.comingSoonH3.count > 0 ? `Jatuh tempo ≤ 3 hari: ${summary.comingSoonH3.count} nota ${rupiah(summary.comingSoonH3.amount)}` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return { title: "Tempo Jatuh Tempo", body: parts.join(" · "), url: "/tempo", tag: "tempo-due" };
}

export async function notifyTempoDue(): Promise<{ sent: number }> {
  if (!pushConfig().enabled) return { sent: 0 };
  try {
    const { getTempoMetricsSummary } = await import("@/lib/tempo/store");
    const message = tempoDueMessage(await getTempoMetricsSummary({}));
    if (!message) return { sent: 0 };
    const result = await sendPushToRoles(PUSH_AUDIENCE.tempoDue, message);
    return { sent: result.sent };
  } catch (error) {
    console.error("[push] notifikasi tempo gagal:", error instanceof Error ? error.message : error);
    return { sent: 0 };
  }
}

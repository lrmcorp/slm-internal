import "server-only";
import { prisma } from "@/lib/db/prisma";
import { PUSH_AUDIENCE, pushConfig } from "./config";
import { sendPushToRoles } from "./send";
import { jakartaDateKey } from "@/lib/date/jakarta";

function addDaysKey(key: string, days: number) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

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
      select: { id: true, isTestTransaction: true, total: true, customerName: true, customerLocation: true, transactionDateKey: true, saleDate: true, approvalStatus: true },
    });
    // Draft (termasuk simpan otomatis) belum transaksi; notifikasi dikirim saat draft difinalkan.
    if (!sale || sale.isTestTransaction || sale.approvalStatus === "draft") return;
    // Nota bertanggal lain (input susulan, impor data lama, atau tanggal ke depan) tidak dikabarkan.
    if ((sale.transactionDateKey ?? jakartaDateKey(sale.saleDate)) !== jakartaDateKey()) return;
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

function tanggal(key: string) {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

/** Isi notifikasi satu nota tempo: "Rp<sisa> atas nama <customer>, jatuh tempo <dd/mm/yyyy>". */
export function tempoDueMessage(row: { id: string; remainingAmount: number; customerName: string; dueKey: string }) {
  return {
    title: "Jatuh Tempo",
    body: `${rupiah(row.remainingAmount)} atas nama ${row.customerName}, jatuh tempo ${tanggal(row.dueKey)}`,
    url: `/tempo/${row.id}`,
    tag: `tempo-${row.id}`,
  };
}

/** Satu notifikasi per nota per pagi, paling lama dulu; cakupan sama dengan menu Tempo (lewat tempo dan <= 3 hari). */
const MAX_TEMPO_NOTIFICATIONS = 20;

export async function notifyTempoDue(today: string = jakartaDateKey()): Promise<{ sent: number }> {
  if (!pushConfig().enabled) return { sent: 0 };
  try {
    const limit = addDaysKey(today, 3);
    const rows = await prisma.tempoReceivable.findMany({
      where: { status: { in: ["open", "overdue", "partial_paid"] }, remainingAmount: { gt: 0 }, dueDate: { lte: new Date(`${addDaysKey(today, 4)}T23:59:59.999Z`) } },
      select: { id: true, customerName: true, remainingAmount: true, dueDate: true },
      orderBy: { dueDate: "asc" },
    });
    const due = rows.map((row) => ({ ...row, dueKey: jakartaDateKey(row.dueDate) })).filter((row) => row.dueKey <= limit).slice(0, MAX_TEMPO_NOTIFICATIONS);
    if (due.length === 0) return { sent: 0 };
    let sent = 0;
    for (const row of due) {
      const result = await sendPushToRoles(PUSH_AUDIENCE.tempoDue, tempoDueMessage({
        id: row.id,
        remainingAmount: Number(row.remainingAmount) || 0,
        customerName: row.customerName,
        dueKey: row.dueKey,
      }));
      sent += result.sent;
    }
    return { sent };
  } catch (error) {
    console.error("[push] notifikasi tempo gagal:", error instanceof Error ? error.message : error);
    return { sent: 0 };
  }
}

/** "DO Terbaru", isi: "<customer> - <n> item - <nama sales>". */
export function newDeliveryOrderMessage(input: { customerName: string; itemCount: number; salesName?: string | null }) {
  const parts = [input.customerName.trim() || "Customer", `${input.itemCount} item`];
  if (input.salesName?.trim()) parts.push(input.salesName.trim());
  return { title: "DO Terbaru", body: parts.join(" - ") };
}

/**
 * Notifikasi untuk Petugas DO saat DO baru dibuat. DO dibuat di dalam transaksi database, jadi baris DO
 * ditunggu sebentar sampai tersimpan. Hanya DO dari penjualan hari ini (impor data lama tidak dikabarkan).
 */
export async function notifyNewDeliveryOrder(deliveryOrderId: string) {
  if (!pushConfig().enabled) return;
  try {
    let row = null;
    for (let attempt = 0; attempt < 5 && !row; attempt++) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 2000));
      row = await prisma.deliveryOrder.findUnique({
        where: { id: deliveryOrderId },
        select: {
          id: true,
          items: { select: { id: true } },
          salesRecord: { select: { customerName: true, createdByNameSnapshot: true, approvalStatus: true, isTestTransaction: true, transactionDateKey: true, saleDate: true } },
        },
      });
    }
    const sale = row?.salesRecord;
    if (!row || !sale || sale.isTestTransaction || sale.approvalStatus === "draft" || sale.approvalStatus === "cancelled") return;
    if ((sale.transactionDateKey ?? jakartaDateKey(sale.saleDate)) !== jakartaDateKey()) return;
    await sendPushToRoles(PUSH_AUDIENCE.newDeliveryOrder, {
      ...newDeliveryOrderMessage({ customerName: sale.customerName, itemCount: row.items.length, salesName: sale.createdByNameSnapshot }),
      url: `/delivery-orders/${row.id}`,
      tag: `do-${row.id}`,
    });
  } catch (error) {
    console.error("[push] notifikasi DO gagal:", error instanceof Error ? error.message : error);
  }
}

import "server-only";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/store";
import type { CurrentUser } from "@/lib/auth/session";

/**
 * Barang baru dari Input Penjualan masuk Master Barang setelah disetujui Owner.
 * Sampai saat itu barangnya nonaktif (tidak tampil di Master Barang maupun pilihan barang), tetapi
 * penjualan, stok, dan DO yang sudah memakainya tetap berjalan. Disetujui: aktif, harga modal 0,
 * harga jual dari penjualan (atau yang diubah Owner saat menyetujui).
 */
export type ProductApprovalStatus = "approved" | "pending_approval" | "rejected";

export type PendingProduct = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  category: string | null;
  sellingPrice: number;
  requestedByName: string | null;
  requestedAt: string | null;
  /** Penjualan yang sudah memakai barang ini (nomor nota dan customer), terbaru dulu. */
  sales: { id: string; number: string; customerName: string; quantity: number; unitPrice: number }[];
};

export class ProductApprovalError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ProductApprovalError";
  }
}

export async function listPendingProducts(): Promise<PendingProduct[]> {
  const rows = await prisma.inventoryProduct.findMany({
    where: { approvalStatus: "pending_approval" },
    orderBy: { requestedAt: "asc" },
    select: { id: true, sku: true, name: true, unit: true, category: true, sellingPrice: true, requestedByName: true, requestedAt: true }
  });
  if (!rows.length) return [];
  const items = await prisma.salesRecordItem.findMany({
    where: { OR: rows.map((row) => ({ productRef: { equals: row.sku, mode: "insensitive" as const } })) },
    orderBy: { salesRecord: { createdAt: "desc" } },
    take: 200,
    select: {
      productRef: true, quantity: true, unitPrice: true,
      salesRecord: { select: { id: true, transactionNumber: true, customerName: true } }
    }
  }).catch(() => []);
  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    unit: row.unit,
    category: row.category,
    sellingPrice: Number(row.sellingPrice),
    requestedByName: row.requestedByName,
    requestedAt: row.requestedAt?.toISOString() ?? null,
    sales: items
      .filter((item) => item.productRef.toLowerCase() === row.sku.toLowerCase())
      .slice(0, 5)
      .map((item) => ({
        id: item.salesRecord.id,
        number: item.salesRecord.transactionNumber || "Draft",
        customerName: item.salesRecord.customerName,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice)
      }))
  }));
}

export async function countPendingProducts(): Promise<number> {
  return prisma.inventoryProduct.count({ where: { approvalStatus: "pending_approval" } }).catch(() => 0);
}

/** Tandai barang yang baru dibuat dari Input Penjualan sebagai menunggu persetujuan. Owner langsung disetujui. */
export async function markRequestedFromSale(productId: string, user: Pick<CurrentUser, "name" | "role">): Promise<ProductApprovalStatus> {
  const now = new Date();
  const autoApprove = user.role === "OWNER";
  await prisma.inventoryProduct.update({
    where: { id: productId },
    data: autoApprove
      ? { costPrice: 0, approvalStatus: "approved", isActive: true, requestedByName: user.name, requestedAt: now, approvalDecidedBy: user.name, approvalDecidedAt: now }
      : { costPrice: 0, approvalStatus: "pending_approval", isActive: false, requestedByName: user.name, requestedAt: now }
  });
  return autoApprove ? "approved" : "pending_approval";
}

export async function decideProductApproval(
  productId: string,
  decision: { action: "approve" | "reject"; sellingPrice?: number; reason?: string },
  user: Pick<CurrentUser, "name" | "role">
) {
  if (user.role !== "OWNER") throw new ProductApprovalError("Hanya Owner yang dapat menyetujui barang baru.", 403);
  const product = await prisma.inventoryProduct.findUnique({ where: { id: productId } });
  if (!product) throw new ProductApprovalError("Barang tidak ditemukan.", 404);
  if (product.approvalStatus !== "pending_approval") throw new ProductApprovalError("Barang ini sudah diputuskan sebelumnya.", 409);
  const now = new Date();
  if (decision.action === "approve") {
    const sellingPrice = decision.sellingPrice ?? Number(product.sellingPrice);
    if (!Number.isFinite(sellingPrice) || sellingPrice < 0) throw new ProductApprovalError("Harga jual tidak valid.");
    const updated = await prisma.inventoryProduct.update({
      where: { id: productId },
      data: { approvalStatus: "approved", isActive: true, costPrice: 0, sellingPrice, approvalDecidedBy: user.name, approvalDecidedAt: now }
    });
    await recordAudit({ entityType: "product", entityId: productId, action: "approve", beforeValue: product, afterValue: updated, reason: `Barang baru ${product.sku} disetujui masuk Master Barang` });
    return updated;
  }
  const reason = decision.reason?.trim();
  const updated = await prisma.inventoryProduct.update({
    where: { id: productId },
    data: {
      approvalStatus: "rejected", isActive: false, approvalDecidedBy: user.name, approvalDecidedAt: now,
      notes: [product.notes, `Ditolak ${user.name}${reason ? `: ${reason}` : ""}`].filter(Boolean).join("\n")
    }
  });
  await recordAudit({ entityType: "product", entityId: productId, action: "reject", beforeValue: product, afterValue: updated, reason: `Barang baru ${product.sku} ditolak${reason ? `: ${reason}` : ""}` });
  return updated;
}

export type ExternalSaleProduct = { sku: string; name: string; unit?: string | null; unitPrice: number };

/**
 * Kode barang dari nota MJ yang belum ada di Master Barang SLM dibuat sebagai barang menunggu persetujuan
 * Owner: nonaktif, harga modal 0, harga jual = harga SLM/AJ di nota (MJ sudah menghitungnya dari harga MJ
 * dikurangi markup). Kode yang sudah ada (termasuk yang masih menunggu) tidak diubah. Mengembalikan kode baru.
 */
export async function ensurePendingProductsForExternalSale(items: ExternalSaleProduct[], requestedByName: string): Promise<ExternalSaleProduct[]> {
  const unique = new Map<string, ExternalSaleProduct>();
  for (const item of items) {
    const sku = item.sku.trim();
    if (sku && !unique.has(sku.toLowerCase())) unique.set(sku.toLowerCase(), { ...item, sku });
  }
  if (!unique.size) return [];
  const existing = await prisma.inventoryProduct.findMany({
    where: { OR: Array.from(unique.values()).map((item) => ({ sku: { equals: item.sku, mode: "insensitive" as const } })) },
    select: { sku: true }
  });
  for (const row of existing) unique.delete(row.sku.toLowerCase());
  const created: ExternalSaleProduct[] = [];
  const now = new Date();
  for (const item of Array.from(unique.values())) {
    try {
      await prisma.inventoryProduct.create({
        data: {
          sku: item.sku, name: item.name.trim() || item.sku, unit: item.unit?.trim() || "Lusin",
          costPrice: 0, sellingPrice: Math.max(0, Math.round(item.unitPrice)),
          isActive: false, approvalStatus: "pending_approval", requestedByName, requestedAt: now
        }
      });
      created.push(item);
    } catch (error) {
      // Kode yang sama dibuat bersamaan oleh permintaan lain: cukup dipakai.
      if ((error as { code?: string })?.code !== "P2002") throw error;
    }
  }
  return created;
}

import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { jakartaDateKey } from "@/lib/date/jakarta";
import { createTransfer } from "./service";
import { InventoryError } from "./errors";

/**
 * Permintaan barang ke gudang.
 *   1. Sales membuat permintaan (barang + qty, dari gudang ke toko). Status MENUNGGU.
 *   2. Petugas Gudang memproses: centang bila barang ada sesuai permintaan, atau isi qty yang benar-benar ada.
 *      Stok dipindah lewat transfer (langsung diterima) sebanyak qty yang dikirim.
 *   3. Semua sesuai -> SELESAI. Ada yang kurang -> SEBAGIAN; sales dan Super Admin dikabari dan muncul di Laporan Selisih.
 */

type Actor = { id: string; name: string };

const qty = z.coerce.number().finite();

export const warehouseRequestSchema = z.object({
  fromLocationId: z.string().trim().min(1, "Pilih gudang asal"),
  toLocationId: z.string().trim().min(1, "Pilih lokasi tujuan"),
  notes: z.string().trim().max(500).optional(),
  items: z.array(z.object({
    productId: z.string().trim().min(1, "Pilih barang"),
    quantity: qty.positive("Qty harus lebih dari 0").max(1e7),
  })).min(1, "Minimal satu barang").max(100, "Maksimal 100 barang per permintaan"),
}).refine((v) => v.fromLocationId !== v.toLocationId, { message: "Lokasi asal dan tujuan tidak boleh sama", path: ["toLocationId"] });

export const processRequestSchema = z.object({
  notes: z.string().trim().max(500).optional(),
  items: z.array(z.object({
    itemId: z.string().trim().min(1),
    fulfilledQty: qty.min(0, "Qty tidak boleh negatif"),
    note: z.string().trim().max(300).optional(),
  })).min(1),
});

export type WarehouseRequestInput = z.infer<typeof warehouseRequestSchema>;
export type ProcessRequestInput = z.infer<typeof processRequestSchema>;

const num = (v: unknown) => (v == null ? 0 : Number(v));
const round2 = (v: number) => Math.round(v * 100) / 100;

async function nextRequestNumber(date = new Date()) {
  const key = jakartaDateKey(date).slice(2).replaceAll("-", "");
  const prefix = `PB-${key}-`;
  const last = await prisma.warehouseRequest.findFirst({ where: { requestNumber: { startsWith: prefix } }, orderBy: { requestNumber: "desc" }, select: { requestNumber: true } });
  const seq = last ? Number(last.requestNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(2, "0")}`;
}

export async function createWarehouseRequest(input: WarehouseRequestInput, actor: Actor) {
  const [from, to] = await Promise.all([
    prisma.inventoryLocation.findUnique({ where: { id: input.fromLocationId } }),
    prisma.inventoryLocation.findUnique({ where: { id: input.toLocationId } }),
  ]);
  if (!from?.isActive || !to?.isActive) throw new InventoryError("VALIDATION", "Lokasi asal atau tujuan tidak ditemukan.");
  // Barang yang sama digabung supaya gudang tidak memproses dua baris.
  const merged = new Map<string, number>();
  for (const item of input.items) merged.set(item.productId, round2((merged.get(item.productId) ?? 0) + item.quantity));
  const products = await prisma.inventoryProduct.findMany({ where: { id: { in: Array.from(merged.keys()) }, isActive: true }, select: { id: true, sku: true, name: true, unit: true } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const missing = Array.from(merged.keys()).find((id) => !byId.has(id));
  if (missing) throw new InventoryError("VALIDATION", "Ada barang yang tidak ditemukan di Master Barang.");

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await prisma.warehouseRequest.create({
        data: {
          requestNumber: await nextRequestNumber(),
          fromLocationId: from.id,
          toLocationId: to.id,
          notes: input.notes || null,
          requestedByUserId: actor.id,
          requestedByName: actor.name,
          items: {
            create: Array.from(merged.entries()).map(([productId, quantity], index) => {
              const p = byId.get(productId)!;
              return { productId, sku: p.sku, name: p.name, unit: p.unit, requestedQty: quantity, sortOrder: index };
            }),
          },
        },
        include: { items: true },
      });
    } catch (error) {
      // Nomor bentrok dengan permintaan lain yang dibuat bersamaan: ambil nomor berikutnya.
      if ((error as { code?: string }).code === "P2002" && attempt < 3) continue;
      throw error;
    }
  }
  throw new InventoryError("INVALID_STATE", "Gagal membuat nomor permintaan. Coba lagi.", 409);
}

export async function processWarehouseRequest(id: string, input: ProcessRequestInput, actor: Actor) {
  const request = await prisma.warehouseRequest.findUnique({ where: { id }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  if (!request) throw new InventoryError("NOT_FOUND", "Permintaan tidak ditemukan.", 404);
  if (request.status !== "MENUNGGU") throw new InventoryError("INVALID_STATE", `Permintaan ${request.requestNumber} sudah diproses.`, 409);
  const answers = new Map(input.items.map((i) => [i.itemId, i]));
  const lines = request.items.map((item) => {
    const answer = answers.get(item.id);
    if (!answer) throw new InventoryError("VALIDATION", `Barang ${item.sku} belum diisi.`);
    const requested = num(item.requestedQty);
    const fulfilled = round2(answer.fulfilledQty);
    if (fulfilled > requested) throw new InventoryError("VALIDATION", `Qty ${item.sku} tidak boleh lebih dari yang diminta (${requested}).`);
    return { item, requested, fulfilled, note: answer.note || null };
  });

  // Stok dipindah dulu (idempotent per permintaan), lalu status disimpan; diulang aman bila status gagal tersimpan.
  const toSend = lines.filter((l) => l.fulfilled > 0);
  const transfer = toSend.length
    ? await createTransfer({
        fromLocationId: request.fromLocationId,
        toLocationId: request.toLocationId,
        receiveNow: true,
        idempotencyKey: `warehouse-request:${request.id}`,
        notes: `Permintaan barang ${request.requestNumber} (${request.requestedByName})`,
        items: toSend.map((l) => ({ productId: l.item.productId, quantity: l.fulfilled })),
      }, { id: actor.id, name: actor.name })
    : null;

  const complete = lines.every((l) => l.fulfilled === l.requested);
  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.warehouseRequest.updateMany({
      where: { id, status: "MENUNGGU" },
      data: {
        status: complete ? "SELESAI" : "SEBAGIAN",
        processedByUserId: actor.id,
        processedByName: actor.name,
        processedAt: new Date(),
        processNotes: input.notes || null,
        transferId: transfer?.id ?? null,
      },
    });
    if (claimed.count !== 1) throw new InventoryError("INVALID_STATE", `Permintaan ${request.requestNumber} sudah diproses petugas lain.`, 409);
    for (const l of lines) await tx.warehouseRequestItem.update({ where: { id: l.item.id }, data: { fulfilledQty: l.fulfilled, note: l.note } });
    return tx.warehouseRequest.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { sortOrder: "asc" } } } });
  });
  return { request: updated, complete, transferNumber: transfer?.transferNumber ?? null };
}

export async function cancelWarehouseRequest(id: string, reason: string, actor: Actor, canCancelOthers: boolean) {
  const request = await prisma.warehouseRequest.findUnique({ where: { id } });
  if (!request) throw new InventoryError("NOT_FOUND", "Permintaan tidak ditemukan.", 404);
  if (!canCancelOthers && request.requestedByUserId !== actor.id) throw new InventoryError("VALIDATION", "Hanya pembuat permintaan yang bisa membatalkan.", 403);
  const result = await prisma.warehouseRequest.updateMany({ where: { id, status: "MENUNGGU" }, data: { status: "BATAL", cancelledAt: new Date(), cancelReason: reason || null } });
  if (result.count !== 1) throw new InventoryError("INVALID_STATE", "Permintaan sudah diproses gudang, tidak bisa dibatalkan.", 409);
  return { id };
}

export type WarehouseRequestRow = Awaited<ReturnType<typeof listWarehouseRequests>>[number];

export async function listWarehouseRequests(options: { status?: ("MENUNGGU" | "SELESAI" | "SEBAGIAN" | "BATAL")[]; requestedByUserId?: string; from?: string; to?: string; take?: number; order?: "asc" | "desc" } = {}) {
  const rows = await prisma.warehouseRequest.findMany({
    where: {
      status: options.status ? { in: options.status } : undefined,
      requestedByUserId: options.requestedByUserId,
      createdAt: options.from || options.to
        ? { gte: options.from ? new Date(`${options.from}T00:00:00+07:00`) : undefined, lte: options.to ? new Date(`${options.to}T23:59:59.999+07:00`) : undefined }
        : undefined,
    },
    include: { items: { orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: options.order ?? "desc" },
    take: options.take ?? 100,
  });
  const locationIds = Array.from(new Set(rows.flatMap((r) => [r.fromLocationId, r.toLocationId])));
  const locations = new Map((await prisma.inventoryLocation.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]));
  return rows.map((r) => ({
    id: r.id,
    requestNumber: r.requestNumber,
    status: r.status,
    fromName: locations.get(r.fromLocationId) ?? "-",
    toName: locations.get(r.toLocationId) ?? "-",
    notes: r.notes,
    requestedByUserId: r.requestedByUserId,
    requestedByName: r.requestedByName,
    processedByName: r.processedByName,
    processedAt: r.processedAt?.toISOString() ?? null,
    processNotes: r.processNotes,
    cancelReason: r.cancelReason,
    createdAt: r.createdAt.toISOString(),
    items: r.items.map((i) => ({
      id: i.id, productId: i.productId, sku: i.sku, name: i.name, unit: i.unit,
      requestedQty: num(i.requestedQty), fulfilledQty: i.fulfilledQty == null ? null : num(i.fulfilledQty), note: i.note,
    })),
  }));
}

/** Laporan selisih: baris barang yang dikirim kurang dari yang diminta, plus ringkasan periode. */
export async function warehouseShortageReport(range: { from: string; to: string }) {
  const rows = await listWarehouseRequests({ status: ["SELESAI", "SEBAGIAN"], from: range.from, to: range.to, take: 2000 });
  const lines = rows.flatMap((r) => r.items
    .filter((i) => i.fulfilledQty != null && i.fulfilledQty < i.requestedQty)
    .map((i) => ({ ...i, requestId: r.id, requestNumber: r.requestNumber, createdAt: r.createdAt, processedAt: r.processedAt, requestedByName: r.requestedByName, processedByName: r.processedByName, shortQty: round2(i.requestedQty - (i.fulfilledQty ?? 0)) })));
  const byProduct = new Map<string, { sku: string; name: string; unit: string; times: number; requested: number; fulfilled: number }>();
  for (const l of lines) {
    const p = byProduct.get(l.productId) ?? { sku: l.sku, name: l.name, unit: l.unit, times: 0, requested: 0, fulfilled: 0 };
    p.times += 1; p.requested += l.requestedQty; p.fulfilled += l.fulfilledQty ?? 0;
    byProduct.set(l.productId, p);
  }
  return {
    summary: {
      processed: rows.length,
      complete: rows.filter((r) => r.status === "SELESAI").length,
      partial: rows.filter((r) => r.status === "SEBAGIAN").length,
      shortLines: lines.length,
    },
    lines,
    products: Array.from(byProduct.values()).map((p) => ({ ...p, requested: round2(p.requested), fulfilled: round2(p.fulfilled), short: round2(p.requested - p.fulfilled) })).sort((a, b) => b.times - a.times || b.short - a.short),
  };
}

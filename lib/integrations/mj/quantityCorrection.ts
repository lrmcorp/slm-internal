import "server-only";
import { Prisma } from "@prisma/client";
import type { Role } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";
import { reverseJournalEntry } from "@/lib/accounting/journalStore";
import { replaceSaleStockLocal } from "@/lib/inventory/service";
import { nextRevisionReference } from "@/lib/api/stockReleases";
import { postSalesCogsJournal, postSalesInvoiceJournal } from "@/lib/sales/postingHooks";
import { syncDeliveryOrderForSale } from "@/lib/deliveryOrders/store";

export type QuantityCorrectionInput = {
  reference: string;
  items: { sku: string; quantity: number }[];
  apply?: boolean;
  reason?: string;
};

type Actor = { id: string; name: string; role: Role };

const num = (value: Prisma.Decimal | number | null | undefined) => Number(value ?? 0);
const money = (value: number) => Math.round(value * 100) / 100;
const skuKey = (value: string) => value.trim().toUpperCase();

/**
 * Koreksi jumlah barang pada invoice MJ yang sudah tercatat di SLM, misalnya MJ mengirim jumlah lusin
 * untuk barang yang satuannya Gross. Harga satuan SLM tidak diubah. Tanpa `apply` hanya pratinjau.
 * Saat diterapkan: stok dilepas ulang sebagai revisi (X-REVn), jurnal penjualan dibalik lalu diposting ulang,
 * HPP dihitung ulang dari pergerakan stok yang baru, dan DO ikut jumlah baru.
 */
export async function correctMjInvoiceQuantities(input: QuantityCorrectionInput, actor: Actor) {
  const reference = input.reference.trim();
  const row = await prisma.salesRecord.findFirst({
    where: { source: "MJ", OR: [{ externalReference: reference }, { transactionNumber: reference }] },
    include: { items: { orderBy: { sortOrder: "asc" } } }
  });
  if (!row) throw new Error(`Invoice MJ ${reference} tidak ditemukan.`);
  if (row.approvalStatus !== "approved") throw new Error(`Invoice ${reference} berstatus ${row.approvalStatus}; hanya invoice aktif yang bisa dikoreksi.`);
  if (row.paymentMethod === "Tempo") throw new Error("Invoice Tempo belum didukung koreksi ini (piutang perlu ikut disesuaikan). Batalkan dari MJ lalu input ulang.");
  const posted = await prisma.salesReturn.count({ where: { salesRecordId: row.id, status: "POSTED" } });
  if (posted > 0) throw new Error("Invoice ini sudah punya retur yang diposting; koreksi jumlah tidak bisa dilakukan.");

  const changes = input.items.map((change) => {
    const lines = row.items.filter((item) => skuKey(item.productRef) === skuKey(change.sku));
    if (lines.length === 0) throw new Error(`Barang ${change.sku} tidak ada di invoice ${reference}.`);
    if (lines.length > 1) throw new Error(`Barang ${change.sku} muncul ${lines.length} baris di invoice; koreksi per baris belum didukung.`);
    if (!(change.quantity > 0)) throw new Error(`Jumlah baru ${change.sku} harus lebih dari 0.`);
    const line = lines[0];
    return { line, oldQty: num(line.quantity), newQty: money(change.quantity) };
  });

  const lineTotal = (qty: number, item: (typeof row.items)[number]) => money(qty * num(item.unitPrice) - num(item.discount));
  const newQtyById = new Map(changes.map((c) => [c.line.id, c.newQty]));
  const oldTotal = num(row.total);
  const newTotal = money(row.items.reduce((sum, item) => sum + lineTotal(newQtyById.get(item.id) ?? num(item.quantity), item), 0));

  const preview = {
    reference: row.externalReference ?? reference,
    customer: row.customerName,
    old_total: oldTotal,
    new_total: newTotal,
    lines: changes.map((c) => ({
      sku: c.line.productRef,
      unit_price: num(c.line.unitPrice),
      old_quantity: c.oldQty,
      new_quantity: c.newQty,
      old_subtotal: lineTotal(c.oldQty, c.line),
      new_subtotal: lineTotal(c.newQty, c.line)
    }))
  };
  if (!input.apply) return { applied: false, ...preview };

  const reason = (input.reason || "Koreksi jumlah barang invoice MJ").trim();

  // 1. Stok: lepas ulang seluruh rantai rilis dengan jumlah baru (satu transaksi; gagal berarti rilis lama utuh).
  let stockReleaseReference = row.stockReleaseReference;
  if (row.stockReleaseReference && row.stockReleaseStatus !== "reversed") {
    const base = row.stockReleaseReference.replace(/-REV\d+$/i, "");
    const chain = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(-REV\\d+)?$`, "i");
    const movements = (await prisma.inventoryMovement.findMany({
      where: { referenceType: { in: ["SALE", "SALE_REVERSAL"] }, referenceNumber: { startsWith: base } },
      include: { product: { select: { sku: true } } }
    })).filter((m) => m.referenceNumber && chain.test(m.referenceNumber));
    const net = new Map<string, { productId: string; locationId: string; sku: string; released: number }>();
    for (const m of movements) {
      const key = `${m.productId}:${m.locationId}`;
      const entry = net.get(key) ?? { productId: m.productId, locationId: m.locationId, sku: m.product.sku, released: 0 };
      entry.released -= num(m.quantity);
      net.set(key, entry);
    }
    const ratioBySku = new Map(changes.map((c) => [skuKey(c.line.productRef), c.newQty / c.oldQty]));
    const items = Array.from(net.values())
      .map((entry) => ({ ...entry, released: money(entry.released * (ratioBySku.get(skuKey(entry.sku)) ?? 1)) }))
      .filter((entry) => entry.released > 0)
      .map((entry) => ({ productId: entry.productId, warehouseId: entry.locationId, quantity: entry.released, allowNegative: true }));
    if (items.length > 0) {
      const latest = movements
        .filter((m) => m.referenceType === "SALE")
        .map((m) => m.referenceNumber as string)
        .sort((a, b) => Number(a.match(/-REV(\d+)$/i)?.[1] ?? 0) - Number(b.match(/-REV(\d+)$/i)?.[1] ?? 0))
        .pop() ?? row.stockReleaseReference;
      stockReleaseReference = nextRevisionReference(latest);
      await replaceSaleStockLocal({
        reference: stockReleaseReference,
        oldReference: row.stockReleaseReference,
        saleDate: row.saleDate.toISOString().slice(0, 10),
        sourceNumber: row.transactionNumber ?? undefined,
        items
      }, { id: actor.id, name: actor.name });
    }
  }

  // 2. Jurnal penjualan lama dibalik; kunci sumbernya dipindah supaya jurnal baru bisa diposting dengan total baru.
  if (row.journalEntryId) {
    const journal = await prisma.journalEntry.findUnique({ where: { id: row.journalEntryId }, select: { status: true, reversedByJournalId: true } });
    if (journal && journal.status !== "REVERSED" && !journal.reversedByJournalId) {
      await reverseJournalEntry(row.journalEntryId, actor, reason);
    }
    await prisma.journalEntry.update({ where: { id: row.journalEntryId }, data: { sourceId: `${row.id}:sebelum-koreksi-${Date.now()}` } });
  }

  const metadata = row.integrationMetadata && typeof row.integrationMetadata === "object" ? row.integrationMetadata as Record<string, unknown> : {};
  const history = Array.isArray(metadata.quantity_corrections) ? metadata.quantity_corrections : [];
  await prisma.$transaction(async (tx) => {
    for (const c of changes) await tx.salesRecordItem.update({ where: { id: c.line.id }, data: { quantity: c.newQty } });
    await tx.salesRecord.update({
      where: { id: row.id },
      data: {
        total: newTotal,
        journalEntryId: null,
        stockReleaseReference,
        integrationMetadata: { ...metadata, quantity_corrections: [...history, { at: new Date().toISOString(), by: actor.name, reason, ...preview }] } as Prisma.InputJsonValue
      }
    });
    await tx.auditLog.create({
      data: {
        id: crypto.randomUUID(), entityType: "sales", entityId: row.id, action: "update",
        beforeValue: { total: oldTotal, lines: preview.lines.map((l) => ({ sku: l.sku, quantity: l.old_quantity })) },
        afterValue: { total: newTotal, lines: preview.lines.map((l) => ({ sku: l.sku, quantity: l.new_quantity })) },
        userId: actor.id, userNameSnapshot: actor.name, userRoleSnapshot: actor.role,
        reason: `Koreksi jumlah invoice MJ ${row.transactionNumber ?? reference}: ${reason}`
      }
    });
  });

  // 3. Posting ulang jurnal penjualan & HPP (HPP lama dibalik otomatis karena referensi stoknya berganti), lalu DO.
  await postSalesInvoiceJournal(row.id);
  await postSalesCogsJournal(row.id);
  await syncDeliveryOrderForSale(row.id).catch((error) => console.error("[DO] Gagal menyesuaikan DO setelah koreksi:", error));

  return { applied: true, stock_release_reference: stockReleaseReference, ...preview };
}

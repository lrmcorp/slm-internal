import "server-only";
import type { Role } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/prisma";

type Actor = { id: string; name: string; role: Role };

const num = (value: unknown) => Number(value ?? 0);

/** Lusin per satuan lama: Gross = 12 lusin (144 pcs). Bila isi pcs diisi kelipatan 12, ikut isi itu. */
function lusinPerUnit(pcsPerUnit: number | null) {
  return pcsPerUnit && pcsPerUnit > 12 && pcsPerUnit % 12 === 0 ? pcsPerUnit / 12 : 12;
}

/**
 * Ubah satuan barang Gross menjadi Lusin. Jumlah stok (saldo, riwayat pergerakan, lapisan biaya FIFO, dokumen
 * transfer/opname/penyesuaian) dikali jumlah lusin per gross; harga dan biaya per satuan dibagi angka yang sama,
 * jadi nilai persediaan tidak berubah. Tanpa `apply` hanya pratinjau. Invoice penjualan lama tidak diubah
 * (barisnya menyimpan satuan Gross sendiri).
 */
export async function convertGrossProductsToLusin(input: { skus?: string[]; apply?: boolean }, actor: Actor) {
  const products = await prisma.inventoryProduct.findMany({
    where: {
      unit: { equals: "Gross", mode: "insensitive" },
      ...(input.skus?.length ? { sku: { in: input.skus } } : {})
    },
    include: { balances: { select: { quantity: true } } },
    orderBy: { sku: "asc" }
  });
  if (input.skus?.length) {
    const found = new Set(products.map((p) => p.sku));
    const missing = input.skus.filter((sku) => !found.has(sku));
    if (missing.length) throw new Error(`Barang ini tidak ditemukan atau satuannya bukan Gross: ${missing.join(", ")}`);
  }

  const preview = products.map((p) => {
    const factor = lusinPerUnit(p.pcsPerUnit);
    const stock = p.balances.reduce((sum, b) => sum + num(b.quantity), 0);
    return {
      sku: p.sku,
      name: p.name,
      factor,
      stock_gross: stock,
      stock_lusin: Math.round(stock * factor * 100) / 100,
      price_gross: num(p.sellingPrice),
      price_lusin: Math.round((num(p.sellingPrice) / factor) * 100) / 100
    };
  });
  if (!input.apply || products.length === 0) return { applied: false, count: preview.length, products: preview };

  await prisma.$transaction(async (tx) => {
    for (const p of products) {
      const f = lusinPerUnit(p.pcsPerUnit);
      await tx.$executeRaw`UPDATE "InventoryMovement" SET "quantity" = "quantity" * ${f}, "balanceBefore" = "balanceBefore" * ${f}, "balanceAfter" = "balanceAfter" * ${f}, "unitCost" = ROUND("unitCost" / ${f}, 2) WHERE "productId" = ${p.id}`;
      await tx.$executeRaw`UPDATE "InventoryBalance" SET "quantity" = "quantity" * ${f}, "avgCost" = ROUND("avgCost" / ${f}, 2) WHERE "productId" = ${p.id}`;
      await tx.$executeRaw`UPDATE "InventoryCostConsumption" c SET "quantity" = c."quantity" * ${f}, "unitCost" = ROUND(c."unitCost" / ${f}, 4) FROM "InventoryCostLayer" l WHERE c."layerId" = l."id" AND l."productId" = ${p.id}`;
      await tx.$executeRaw`UPDATE "InventoryCostLayer" SET "quantity" = "quantity" * ${f}, "remaining" = "remaining" * ${f}, "unitCost" = ROUND("unitCost" / ${f}, 4) WHERE "productId" = ${p.id}`;
      await tx.$executeRaw`UPDATE "InventoryTransferItem" SET "quantity" = "quantity" * ${f} WHERE "productId" = ${p.id}`;
      await tx.$executeRaw`UPDATE "InventoryOpnameItem" SET "systemQty" = "systemQty" * ${f}, "countedQty" = "countedQty" * ${f}, "differenceQty" = "differenceQty" * ${f} WHERE "productId" = ${p.id}`;
      await tx.$executeRaw`UPDATE "InventoryAdjustmentItem" SET "quantity" = "quantity" * ${f}, "unitCost" = ROUND("unitCost" / ${f}, 2) WHERE "productId" = ${p.id}`;
      await tx.$executeRaw`UPDATE "InventoryProduct" SET
        "unit" = 'Lusin',
        "sellingPrice" = ROUND("sellingPrice" / ${f}, 2),
        "costPrice" = ROUND("costPrice" / ${f}, 2),
        "katalogPromoPrice" = ROUND("katalogPromoPrice" / ${f}, 2),
        "priceRmb" = ROUND("priceRmb" / ${f}, 4),
        "extraCostIdr" = ROUND("extraCostIdr" / ${f}, 2),
        "cbmPerUnit" = ROUND("cbmPerUnit" / ${f}, 6),
        "minimumStock" = "minimumStock" * ${f},
        "unitsPerKoli" = "unitsPerKoli" * ${f},
        "pcsPerUnit" = 12,
        "updatedAt" = NOW()
        WHERE "id" = ${p.id}`;
    }
    await tx.auditLog.create({
      data: {
        id: crypto.randomUUID(), entityType: "inventory_product", entityId: "unit-conversion", action: "update",
        beforeValue: preview.map((p) => ({ sku: p.sku, unit: "Gross", stock: p.stock_gross, sellingPrice: p.price_gross })),
        afterValue: preview.map((p) => ({ sku: p.sku, unit: "Lusin", stock: p.stock_lusin, sellingPrice: p.price_lusin })),
        userId: actor.id, userNameSnapshot: actor.name, userRoleSnapshot: actor.role,
        reason: `Satuan ${preview.length} barang diubah dari Gross ke Lusin (stok dikali, harga dibagi jumlah lusin per gross)`
      }
    });
  }, { timeout: 120_000 });

  return { applied: true, count: preview.length, products: preview };
}

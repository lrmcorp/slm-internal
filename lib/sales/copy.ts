import "server-only";
import { prisma } from "@/lib/db/prisma";
import type { Sale, SalesItem } from "@/lib/types/sales";
import { applyCurrentProductPrices, type CurrentProductPrice } from "@/lib/sales/copyItems";

/**
 * Transaksi asal untuk tombol Salin di Riwayat Penjualan. Barangnya memakai harga dan satuan
 * Master Barang saat ini, supaya salinan transaksi lama tidak membawa harga atau satuan lama.
 */
export async function saleForCopy(sale: Sale): Promise<Sale> {
  const skus = Array.from(new Set(sale.items.map((item) => item.productRef.trim()).filter(Boolean)));
  let products: CurrentProductPrice[] = [];
  if (skus.length) {
    const rows = await prisma.inventoryProduct.findMany({
      where: { sku: { in: skus, mode: "insensitive" }, isActive: true },
      select: { id: true, sku: true, unit: true, sellingPrice: true, erpProductId: true }
    }).catch(() => []);
    products = rows.map((row) => ({
      sku: row.sku,
      // Sama dengan id produk di form penjualan: id ERP lama bila ada.
      productId: row.erpProductId != null ? String(row.erpProductId) : row.id,
      unit: row.unit,
      sellingPrice: Number(row.sellingPrice)
    }));
  }
  const items: SalesItem[] = applyCurrentProductPrices(sale.items, products);
  return { ...sale, items };
}

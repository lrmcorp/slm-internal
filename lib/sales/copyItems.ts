import type { SalesItem } from "@/lib/types/sales";

export type CurrentProductPrice = { sku: string; productId: string; unit: string; sellingPrice: number };

/**
 * Barang yang masih ada di Master Barang ikut harga jual dan satuan saat ini, dan dipilih sebagai
 * barang master (bukan barang manual). Barang yang sudah tidak aktif dibiarkan apa adanya supaya
 * tetap terlihat di form dan bisa diganti.
 */
export function applyCurrentProductPrices(items: SalesItem[], products: CurrentProductPrice[]): SalesItem[] {
  const bySku = new Map(products.map((product) => [product.sku.trim().toLowerCase(), product]));
  return items.map((item) => {
    const product = bySku.get(item.productRef.trim().toLowerCase());
    if (!product) return item;
    return {
      ...item,
      productRef: product.sku,
      productId: product.productId,
      productInputMode: "erp" as const,
      manualProduct: undefined,
      unitSnapshot: product.unit || item.unitSnapshot,
      uomIdSnapshot: !product.unit || product.unit === item.unitSnapshot ? item.uomIdSnapshot : undefined,
      unitPrice: product.sellingPrice > 0 ? product.sellingPrice : item.unitPrice,
    };
  });
}

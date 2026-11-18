import { describe, expect, it } from "vitest";
import { applyCurrentProductPrices } from "@/lib/sales/copyItems";

describe("Salin penjualan: barang memakai Master Barang saat ini", () => {
  it("takes today's price and unit, and turns an MJ manual line into a master product", () => {
    const [item] = applyCurrentProductPrices(
      [{ productRef: "ajmj-12", productId: "old", productInputMode: "manual", manualProduct: { sku: "ajmj-12", name: "Gelas" }, unitSnapshot: "Gross", uomIdSnapshot: 4, quantity: 3, unitPrice: 180_000, discount: 0 }],
      [{ sku: "AJMJ-12", productId: "prod-12", unit: "Lusin", sellingPrice: 15_000 }]
    );
    expect(item).toMatchObject({ productRef: "AJMJ-12", productId: "prod-12", productInputMode: "erp", unitSnapshot: "Lusin", unitPrice: 15_000, quantity: 3 });
    expect(item.manualProduct).toBeUndefined();
    expect(item.uomIdSnapshot).toBeUndefined();
  });

  it("keeps an item that is no longer in Master Barang as it was, and keeps the old price when the master has none", () => {
    const items = [
      { productRef: "LAMA-1", quantity: 2, unitPrice: 9_000 },
      { productRef: "NOL-1", unitSnapshot: "Pcs", uomIdSnapshot: 1, quantity: 1, unitPrice: 5_000 },
    ];
    const result = applyCurrentProductPrices(items, [{ sku: "NOL-1", productId: "p", unit: "Pcs", sellingPrice: 0 }]);
    expect(result[0]).toEqual(items[0]);
    expect(result[1]).toMatchObject({ unitPrice: 5_000, uomIdSnapshot: 1 });
  });
});

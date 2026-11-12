/** PATCH barang parsial di database (jalan bila INVENTORY_TEST_DATABASE_URL diset). Kasus nyata: harga jual AMJ02-1 jadi Rp0 setelah ganti kategori. */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit/store", () => ({ recordAudit: async () => undefined }));

const url = process.env.INVENTORY_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("PATCH barang parsial (postgres)", () => {
  let inv: typeof import("@/lib/inventory/service");
  let schema: typeof import("@/lib/inventory/validation");
  const sku = `PARTIAL-${Date.now().toString(36).toUpperCase()}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    inv = await import("@/lib/inventory/service");
    schema = await import("@/lib/inventory/validation");
    await inv.createProduct(schema.productSchema.parse({ sku, name: "Jepit uji", category: "Lain - Lain", unit: "Pcs", sellingPrice: 62000, costPrice: 41000, minimumStock: 5, unitsPerKoli: 24, pcsPerUnit: 12 }));
  });

  it("{ category } saja hanya mengganti kategori; harga dan field lain tetap", async () => {
    const before = await inv.getProduct(sku);
    const after = await inv.updateProduct(sku, schema.productUpdateSchema.parse({ category: "Jepit" }));
    expect(after.category).toBe("Jepit");
    for (const key of ["sellingPrice", "costPrice", "priceRmb", "cbmPerUnit", "unitsPerKoli", "pcsPerUnit", "ownership", "unit", "minimumStock", "isActive"] as const) {
      expect(after[key], key).toEqual(before[key]);
    }
    expect(after.sellingPrice).toBe(62000);
  });

  it("harga jual yang dikirim eksplisit tetap diterapkan", async () => {
    expect((await inv.updateProduct(sku, schema.productUpdateSchema.parse({ sellingPrice: 65000 }))).sellingPrice).toBe(65000);
  });
});

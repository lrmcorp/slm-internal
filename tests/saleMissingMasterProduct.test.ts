import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const findMany = vi.fn();
vi.mock("@/lib/db/prisma", () => ({ prisma: { inventoryProduct: { findMany } } }));
vi.mock("@/lib/inventory/config", async (original) => ({ ...(await original<typeof import("@/lib/inventory/config")>()), isLocalInventory: () => true }));
const { missingMasterProductMessage } = await import("@/lib/api/sales");

describe("barang penjualan yang belum ada di Master Barang", () => {
  it("menyebut kode yang tidak ada dan cara menjadikannya barang baru; abaikan baris barang baru dan beda huruf", async () => {
    findMany.mockResolvedValueOnce([{ sku: "ABC-1" }]);
    const message = await missingMasterProductMessage([
      { productRef: "abc-1", quantity: 1, unitPrice: 1 },
      { productRef: "1288-1203A", quantity: 6, unitPrice: 70834 },
      { productRef: "BARU-9", productInputMode: "manual", quantity: 1, unitPrice: 1 }
    ]);
    expect(message).toContain("Barang 1288-1203A belum ada di Master Barang");
    expect(message).toContain("Jadikan barang baru");
    expect(message).not.toContain("BARU-9");
    expect(message).not.toContain("abc-1");
  });

  it("null bila semua ada atau database gagal dibaca", async () => {
    findMany.mockResolvedValueOnce([{ sku: "ABC-1" }]);
    expect(await missingMasterProductMessage([{ productRef: "ABC-1", quantity: 1, unitPrice: 1 }])).toBeNull();
    findMany.mockRejectedValueOnce(new Error("db"));
    expect(await missingMasterProductMessage([{ productRef: "X", quantity: 1, unitPrice: 1 }])).toBeNull();
  });
});

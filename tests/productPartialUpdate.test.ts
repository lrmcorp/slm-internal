import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { productUpdateSchema } from "@/lib/inventory/validation";

describe("PATCH barang parsial", () => {
  it("{ category } saja tidak membawa harga, unit, stok minimum, atau status aktif", () => {
    expect(productUpdateSchema.parse({ category: "Jepit" })).toEqual({ category: "Jepit" });
  });

  it("harga yang dikirim eksplisit tetap diterapkan, termasuk 0", () => {
    expect(productUpdateSchema.parse({ sellingPrice: 62000, costPrice: 0 })).toEqual({ sellingPrice: 62000, costPrice: 0 });
    expect(productUpdateSchema.parse({ isActive: false })).toEqual({ isActive: false });
  });
});

describe("PATCH parsial lain tanpa default tersembunyi", () => {
  it("lokasi: ganti nama tidak me-reset tipe, boleh minus, default, atau aktif", async () => {
    const { locationUpdateSchema } = await import("@/lib/inventory/validation");
    expect(locationUpdateSchema.parse({ name: "Ruko Baru" })).toEqual({ name: "Ruko Baru" });
  });

  it("akun COA: ganti nama tidak me-reset urutan atau mengaktifkan akun", async () => {
    const { accountUpdateSchema } = await import("@/lib/validation/accountingSchema");
    expect(accountUpdateSchema.parse({ name: "Kas Kecil" })).toEqual({ name: "Kas Kecil" });
  });
});

describe("harga RMB 0 = ikut modal Rupiah", () => {
  it("applyRmbCost tidak menimpa modal bila RMB 0 atau kosong", async () => {
    const { applyRmbCost } = await import("@/lib/inventory/pricing");
    expect(await applyRmbCost({ priceRmb: 0, costPrice: 41000 })).toEqual({ priceRmb: 0, costPrice: 41000 });
    expect(await applyRmbCost({ priceRmb: null, costPrice: 41000 })).toEqual({ priceRmb: null, costPrice: 41000 });
    // RMB lama 0 di database, kiriman hanya biaya lain: modal tetap dari Rupiah.
    expect(await applyRmbCost({ extraCostIdr: 500, costPrice: 41000 }, { priceRmb: 0, extraCostIdr: 0 })).toEqual({ extraCostIdr: 500, costPrice: 41000 });
  });
});

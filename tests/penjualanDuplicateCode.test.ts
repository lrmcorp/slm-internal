import { describe, expect, it } from "vitest";
import { penjualanSchema } from "@/lib/validation/penjualanSchema";

const base = { saleDate: "2026-11-14", customerName: "Budi", tipeId: "SLM", paymentMethod: "Cash", initialPaymentAmount: 0 };
const item = (productRef: string, quantity = 1) => ({ productRef, productId: "1", quantity, unitPrice: 10_000, discount: 0 });

describe("satu kode barang satu baris", () => {
  it("menolak kode yang sama di dua baris, termasuk beda huruf besar/kecil dan spasi", () => {
    const result = penjualanSchema.safeParse({ ...base, items: [item("BRS-A89", 3), item("brs-a89 ", 4)] });
    expect(result.success).toBe(false);
    expect(result.error?.issues.find((i) => i.path.join(".") === "items.1.productRef")?.message).toContain("sudah ada di baris 1");
  });
  it("kode berbeda tetap diterima", () => {
    const result = penjualanSchema.safeParse({ ...base, items: [item("BRS-A89", 7), item("BRS-A90", 4)] });
    expect(result.error?.issues.filter((i) => String(i.path[2]) === "productRef") ?? []).toEqual([]);
  });
});

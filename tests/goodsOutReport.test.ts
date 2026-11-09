import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), names: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { salesRecord: { findMany: mocks.findMany } } }));
vi.mock("@/lib/inventory/catalog", () => ({ productNamesBySku: mocks.names }));

import { getGoodsOutReport } from "@/lib/reports/goodsOut";

const sale = (id: string, customerName: string, items: Array<[string, number, number, number?]>, extra: Record<string, unknown> = {}) => ({
  id, saleDate: new Date("2026-11-09T00:00:00Z"), transactionAt: new Date("2026-11-09T03:00:00Z"), transactionNumber: `INV-${id}`, customerName, source: "SLM", createdByUserId: "u-1",
  items: items.map(([productRef, quantity, unitPrice, discount]) => ({ productRef, quantity, unitPrice, discount: discount ?? 0, unitSnapshot: "Pcs" })),
  ...extra,
});

describe("laporan barang keluar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.names.mockResolvedValue({ "ubur-50": "Ubur Ubur 50" });
    mocks.findMany.mockResolvedValue([
      sale("1", "Budi", [["UBUR-50", 4, 100_000], ["TALI-1", 2, 5_000]]),
      sale("2", "Sari", [["UBUR-50", 3, 100_000, 10_000]]),
      sale("3", "budi ", [["UBUR-50", 3, 100_000]], { source: "MJ" }),
    ]);
  });

  it("mengelompokkan per barang dengan qty, nilai, pembeli unik, nota, dan rincian per nota", async () => {
    const report = await getGoodsOutReport({ from: "2026-11-09", to: "2026-11-09" });
    const ubur = report.items[0];
    expect(ubur).toMatchObject({ sku: "UBUR-50", name: "Ubur Ubur 50", quantity: 10, amount: 990_000, invoiceCount: 3, buyerCount: 2 });
    expect(ubur.lines.map((line) => [line.customerName, line.subtotal, line.isMj])).toEqual([["Budi", 400_000, false], ["Sari", 290_000, false], ["budi ", 300_000, true]]);
    expect(report.items[1]).toMatchObject({ sku: "TALI-1", name: null, quantity: 2, amount: 10_000, invoiceCount: 1 });
    expect(report.totals).toEqual({ quantityLines: 4, amount: 1_000_000, invoiceCount: 3, itemCount: 2 });
  });

  it("menyaring barang lewat kode atau nama, dan tidak menghitung draft, batal, atau transaksi tes", async () => {
    const report = await getGoodsOutReport({ from: "2026-11-01", to: "2026-11-09", keyword: "ubur ubur" });
    expect(report.items.map((item) => item.sku)).toEqual(["UBUR-50"]);
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('"notIn":["draft","cancelled","rejected"]');
    expect(JSON.stringify(where)).toContain('"isTestTransaction":false');
  });

  it("mengikuti batasan nota per user (Admin: notanya sendiri + MJ)", async () => {
    await getGoodsOutReport({ from: "2026-11-09", to: "2026-11-09", scope: { createdByUserId: "admin-1", includeSources: ["MJ"] } });
    expect(JSON.stringify(mocks.findMany.mock.calls[0][0].where)).toContain("admin-1");
  });
});

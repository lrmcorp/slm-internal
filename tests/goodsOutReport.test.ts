import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), names: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { salesRecord: { findMany: mocks.findMany } } }));
vi.mock("@/lib/inventory/catalog", () => ({ productNamesBySku: mocks.names }));

import { getGoodsOutReport } from "@/lib/reports/goodsOut";
import { buildOperationalProfitSummary } from "@/lib/dashboard/summary";
import type { Sale } from "@/lib/types/sales";

type Line = [string, number, number, number?];
const sale = (id: string, customerName: string, items: Line[], extra: Record<string, unknown> = {}) => {
  const gross = items.reduce((sum, [, qty, price, discount]) => sum + qty * price - (discount ?? 0), 0);
  return {
    id, saleDate: new Date("2026-11-09T00:00:00Z"), transactionAt: new Date("2026-11-09T03:00:00Z"), transactionNumber: `INV-${id}`, customerName,
    source: "SLM", createdByUserId: "u-1", tipeId: "W", tipeCodeSnapshot: "W", total: gross, integrationMetadata: null, approvalStatus: "approved",
    items: items.map(([productRef, quantity, unitPrice, discount]) => ({ productRef, productId: productRef, manualProduct: null, quantity, unitPrice, discount: discount ?? 0, unitSnapshot: "Pcs" })),
    ...extra,
  };
};

const rows = [
  sale("1", "Budi", [["UBUR-50", 4, 100_000], ["TALI-1", 2, 5_000]]),
  // Diskon nota Rp20.000 dan ongkir tidak ada: total di bawah jumlah barang.
  sale("2", "Sari", [["UBUR-50", 3, 100_000, 10_000]], { total: 270_000 }),
  // Nota MJ lama (harga MJ, +10%): bagian SLM = ÷ 1,1.
  sale("3", "budi ", [["UBUR-50", 2, 110_000]], { source: "MJ", createdByUserId: "integration:mj" }),
  // Nota MJ baru (sudah harga SLM): tidak dibagi lagi.
  sale("4", "Fachrizal", [["UBUR-50", 1, 100_000]], { source: "MJ", integrationMetadata: { payload: { metadata: { mj_price_basis: "slm" } } } }),
  // Ongkir Rp15.000 ditagihkan di luar barang.
  sale("5", "Rina", [["TALI-1", 1, 5_000]], { total: 20_000 }),
  // Tipe AJ bukan penjualan operasional SLM.
  sale("6", "AJ", [["UBUR-50", 10, 100_000]], { tipeId: "AJ", tipeCodeSnapshot: "AJ" }),
];

describe("laporan barang keluar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.names.mockResolvedValue({ "ubur-50": "Ubur Ubur 50" });
    mocks.findMany.mockResolvedValue(rows);
  });

  it("menghitung nilai barang dengan dasar yang sama dengan omset dashboard", async () => {
    const report = await getGoodsOutReport({ from: "2026-11-09", to: "2026-11-09" });
    const ubur = report.items.find((item) => item.sku === "UBUR-50")!;
    // 400.000 + 270.000 (diskon nota) + 200.000 (MJ lama ÷1,1) + 100.000 (MJ baru)
    expect(ubur).toMatchObject({ name: "Ubur Ubur 50", quantity: 10, amount: 970_000, invoiceCount: 4, buyerCount: 3 });
    expect(ubur.lines.find((line) => line.customerName === "budi ")).toMatchObject({ isMj: true, unitPrice: 100_000, subtotal: 200_000 });
    expect(report.totals).toMatchObject({ amount: 985_000, otherAmount: 15_000, invoiceCount: 5, itemCount: 2 });
  });

  it("nilai barang + tagihan di luar barang = omset dashboard hari itu", async () => {
    const report = await getGoodsOutReport({ from: "2026-11-09", to: "2026-11-09" });
    const dashboardSales = rows.map((row) => ({
      ...row, saleDate: "2026-11-09", total: Number(row.total),
      ...(row.integrationMetadata ? { mjPriceBasis: "slm" } : {}),
    })) as unknown as Sale[];
    const summary = buildOperationalProfitSummary(dashboardSales, [], "2026-11-09", "2026-11", 10, []);
    expect(report.totals.amount + report.totals.otherAmount).toBe(summary.todayRevenue);
  });

  it("hanya nota disetujui, bukan transaksi tes; pencarian kode atau nama", async () => {
    const report = await getGoodsOutReport({ from: "2026-11-01", to: "2026-11-09", keyword: "ubur ubur" });
    expect(report.items.map((item) => item.sku)).toEqual(["UBUR-50"]);
    expect(report.totals.otherAmount).toBe(0);
    const where = JSON.stringify(mocks.findMany.mock.calls[0][0].where);
    expect(where).toContain('"approvalStatus":"approved"');
    expect(where).toContain('"isTestTransaction":false');
  });

  it("mengikuti batasan nota per user (Admin: notanya sendiri + MJ)", async () => {
    await getGoodsOutReport({ from: "2026-11-09", to: "2026-11-09", scope: { createdByUserId: "admin-1", includeSources: ["MJ"] } });
    expect(JSON.stringify(mocks.findMany.mock.calls[0][0].where)).toContain("admin-1");
  });
});

describe("pencocokan Barang Keluar dengan Riwayat Penjualan", () => {
  it("total Riwayat = menunggu approval + AJ + uji + selisih MJ + pembulatan + ongkir + nilai barang", async () => {
    vi.clearAllMocks();
    mocks.names.mockResolvedValue({});
    const pending = sale("7", "Tono", [["TALI-1", 3, 5_000]], { approvalStatus: "pending_approval" });
    const test = sale("8", "Uji", [["TALI-1", 1, 5_000]], { isTestTransaction: true });
    const reportRows = rows.filter((r) => r.approvalStatus === "approved");
    // Panggilan 1: nota laporan (disetujui). Panggilan 2: semua nota Riwayat (bukan draft/batal).
    mocks.findMany.mockResolvedValueOnce(reportRows).mockResolvedValueOnce([...rows, pending, test]);
    const report = await getGoodsOutReport({ from: "2026-11-09", to: "2026-11-09" });
    const r = report.reconciliation!;
    const riwayat = [...rows, pending, test].reduce((sum, row) => sum + Number(row.total), 0);
    expect(r.riwayatTotal).toBe(riwayat);
    expect(r.pendingApproval).toEqual({ count: 1, total: 15_000 });
    expect(r.ajType).toEqual({ count: 1, total: 1_000_000 });
    expect(r.testTransactions).toEqual({ count: 1, total: 5_000 });
    expect(r.mjMarkup).toEqual({ count: 1, total: 20_000 });
    expect(r.goodsAmount).toBe(report.totals.amount);
    expect(r.pendingApproval.total + r.ajType.total + r.testTransactions.total + r.mjMarkup.total + r.rounding + r.otherAmount + r.goodsAmount).toBeCloseTo(r.riwayatTotal, 0);
  });

  it("tidak ada rincian pencocokan saat laporan disaring per barang", async () => {
    vi.clearAllMocks();
    mocks.names.mockResolvedValue({});
    mocks.findMany.mockResolvedValue(rows);
    const report = await getGoodsOutReport({ from: "2026-11-09", to: "2026-11-09", keyword: "tali" });
    expect(report.reconciliation).toBeUndefined();
  });
});

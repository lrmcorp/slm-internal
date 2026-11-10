import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  sendNotification: vi.fn(), setVapidDetails: vi.fn(),
  subFindMany: vi.fn(), subUpdate: vi.fn(), subDelete: vi.fn(),
  saleFind: vi.fn(), productFindMany: vi.fn(), balanceGroupBy: vi.fn(), tempoFindMany: vi.fn(), saleFindMany: vi.fn(),
}));
vi.mock("web-push", () => ({ default: { sendNotification: mocks.sendNotification, setVapidDetails: mocks.setVapidDetails } }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    pushSubscription: { findMany: mocks.subFindMany, update: mocks.subUpdate, delete: mocks.subDelete },
    salesRecord: { findUnique: mocks.saleFind, findMany: mocks.saleFindMany },
    tempoReceivable: { findMany: mocks.tempoFindMany },
    inventoryProduct: { findMany: mocks.productFindMany },
    inventoryBalance: { groupBy: mocks.balanceGroupBy },
  },
}));

import { crossedLowStock, lowStockThreshold, notifyLowStockCrossings, notifyNewSale, notifyTempoDue, tempoDueMessage } from "@/lib/push/notify";
import { sendPushToRoles } from "@/lib/push/send";

const sub = (id: string, role: string, failureCount = 0) => ({ id, endpoint: `https://push.example/${id}`, p256dh: "k", auth: "a", role, failureCount });

describe("notifikasi push", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
    mocks.subFindMany.mockResolvedValue([sub("1", "OWNER")]);
    mocks.sendNotification.mockResolvedValue({});
    mocks.subUpdate.mockResolvedValue({});
    mocks.subDelete.mockResolvedValue({});
  });

  it("batas stok: isi 1 koli bila ada, selain itu stok minimum; dikirim hanya saat melewati batas", () => {
    expect(lowStockThreshold({ unitsPerKoli: 12, minimumStock: 50 })).toBe(12);
    expect(lowStockThreshold({ unitsPerKoli: null, minimumStock: 20 })).toBe(20);
    expect(lowStockThreshold({ unitsPerKoli: null, minimumStock: 0 })).toBeNull();
    expect(crossedLowStock(20, -5, 20)).toBe(true); // 25 -> 20
    expect(crossedLowStock(18, -2, 20)).toBe(false); // sudah di bawah batas sebelumnya
    expect(crossedLowStock(30, -5, 20)).toBe(false); // masih di atas batas
    expect(crossedLowStock(10, 5, 20)).toBe(false); // stok bertambah
    expect(crossedLowStock(5, -10, null)).toBe(false); // tanpa batas
  });

  it("stok minimum dikirim ke Owner, Supervisor, Manager dengan sisa dan batasnya", async () => {
    mocks.productFindMany.mockResolvedValue([{ id: "p1", sku: "UBUR-50", name: "Ubur 50", unit: "Pak", unitsPerKoli: null, minimumStock: 20 }]);
    mocks.balanceGroupBy.mockResolvedValue([{ productId: "p1", _sum: { quantity: 18 } }]);
    await notifyLowStockCrossings(new Map([["p1", -5], ["p2", 0]]));
    expect(mocks.subFindMany).toHaveBeenCalledWith({ where: { role: { in: ["OWNER", "SUPERVISOR", "MANAGER"] } } });
    const payload = JSON.parse(mocks.sendNotification.mock.calls[0][1]);
    expect(payload).toMatchObject({ title: "Stok minimum: Ubur 50", body: "Sisa 18 Pak (batas 20 Pak) · UBUR-50", url: "/inventory?keyword=UBUR-50" });
  });

  it("Transaksi Baru: total dari customer - lokasi, ke Owner dan Supervisor; transaksi tes tidak dikirim", async () => {
    mocks.saleFind.mockResolvedValueOnce({ id: "s1", isTestTransaction: false, total: 1_250_000, customerName: "Budi", customerLocation: "Kupang (NTT)" });
    await notifyNewSale("s1");
    expect(mocks.subFindMany).toHaveBeenCalledWith({ where: { role: { in: ["OWNER", "SUPERVISOR"] } } });
    expect(JSON.parse(mocks.sendNotification.mock.calls[0][1])).toEqual({ title: "Transaksi Baru", body: "Rp1.250.000 dari Budi - Kupang (NTT)", url: "/penjualan/s1", tag: "sale-s1" });

    mocks.sendNotification.mockClear();
    mocks.saleFind.mockResolvedValueOnce({ id: "s2", isTestTransaction: false, total: 50_000, customerName: "Walk In", customerLocation: " " });
    await notifyNewSale("s2");
    expect(JSON.parse(mocks.sendNotification.mock.calls[0][1]).body).toBe("Rp50.000 dari Walk In");

    mocks.sendNotification.mockClear();
    mocks.saleFind.mockResolvedValueOnce({ id: "s3", isTestTransaction: true, total: 1, customerName: "Tes", customerLocation: null });
    await notifyNewSale("s3");
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("langganan yang ditolak layanan push (410) dihapus; tanpa kunci VAPID tidak mengirim apa pun", async () => {
    mocks.subFindMany.mockResolvedValue([sub("1", "OWNER"), sub("2", "OWNER")]);
    mocks.sendNotification.mockResolvedValueOnce({}).mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));
    await expect(sendPushToRoles(["OWNER"], { title: "t", body: "b", url: "/" })).resolves.toMatchObject({ sent: 1, removed: 1 });
    expect(mocks.subDelete).toHaveBeenCalledWith({ where: { id: "2" } });

    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    mocks.sendNotification.mockClear();
    await expect(sendPushToRoles(["OWNER"], { title: "t", body: "b", url: "/" })).resolves.toMatchObject({ sent: 0, removed: 0 });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it("jatuh tempo: satu notifikasi per nota (lewat tempo dan <= 3 hari) ke Owner, Supervisor, Finance", async () => {
    expect(tempoDueMessage({ id: "t1", remainingAmount: 1_250_000, customerName: "Budi", dueKey: "2026-11-12" })).toEqual({
      title: "Jatuh Tempo",
      body: "Rp1.250.000 atas nama Budi, jatuh tempo 12/11/2026",
      url: "/tempo/t1",
      tag: "tempo-t1",
    });

    mocks.tempoFindMany.mockResolvedValueOnce([
      { id: "t1", salesId: "s1", customerName: "Sari", remainingAmount: 500_000, dueDate: new Date("2026-11-05T00:00:00Z") },
      { id: "t2", salesId: "s2", customerName: "Budi", remainingAmount: 1_250_000, dueDate: new Date("2026-11-12T00:00:00Z") },
      { id: "t3", salesId: "s3", customerName: "Rina", remainingAmount: 900_000, dueDate: new Date("2026-11-13T00:00:00Z") },
    ]);
    await expect(notifyTempoDue("2026-11-09")).resolves.toEqual({ sent: 2 });
    expect(mocks.subFindMany).toHaveBeenCalledWith({ where: { role: { in: ["OWNER", "SUPERVISOR", "FINANCE"] } } });
    expect(mocks.sendNotification.mock.calls.map((call) => JSON.parse(call[1]).body)).toEqual([
      "Rp500.000 atas nama Sari, jatuh tempo 05/11/2026",
      "Rp1.250.000 atas nama Budi, jatuh tempo 12/11/2026",
    ]);

    mocks.sendNotification.mockClear();
    mocks.tempoFindMany.mockResolvedValueOnce([]);
    await expect(notifyTempoDue("2026-11-09")).resolves.toEqual({ sent: 0 });
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });
});

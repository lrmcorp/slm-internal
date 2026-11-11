import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: Array<{ roles: readonly string[]; payload: { title: string; body: string; url: string } }> = [];
let row: unknown = null;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/push/send", () => ({ sendPushToRoles: vi.fn(async (roles: readonly string[], payload: { title: string; body: string; url: string }) => { sent.push({ roles, payload }); return { devices: 1, sent: 1, removed: 0, failures: [] }; }) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { deliveryOrder: { findUnique: vi.fn(async () => row) } } }));

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const doRow = (sale: Record<string, unknown>) => ({ id: "do1", items: [{ id: "a" }, { id: "b" }, { id: "c" }], salesRecord: { customerName: "Bu Ani", createdByNameSnapshot: "Nia", approvalStatus: "approved", isTestTransaction: false, transactionDateKey: today, saleDate: new Date(), ...sale } });

describe("notifikasi DO terbaru untuk Petugas DO", () => {
  beforeEach(() => {
    sent.length = 0;
    vi.stubEnv("VAPID_PUBLIC_KEY", "pub");
    vi.stubEnv("VAPID_PRIVATE_KEY", "priv");
  });

  it("format: DO Terbaru / customer - n item - sales", async () => {
    const { newDeliveryOrderMessage } = await import("@/lib/push/notify");
    expect(newDeliveryOrderMessage({ customerName: "Bu Ani", itemCount: 5, salesName: "Nia" })).toEqual({ title: "DO Terbaru", body: "Bu Ani - 5 item - Nia" });
    expect(newDeliveryOrderMessage({ customerName: "Walk In", itemCount: 1, salesName: "" }).body).toBe("Walk In - 1 item");
  });

  it("DO baru hari ini dikirim ke Petugas DO dengan tautan ke DO", async () => {
    row = doRow({});
    const { notifyNewDeliveryOrder } = await import("@/lib/push/notify");
    await notifyNewDeliveryOrder("do1");
    expect(sent).toHaveLength(1);
    expect(sent[0].roles).toEqual(["DELIVERY_DRIVER", "GUDANG"]);
    expect(sent[0].payload).toMatchObject({ title: "DO Terbaru", body: "Bu Ani - 3 item - Nia", url: "/delivery-orders/do1" });
  });

  it("DO dari penjualan tanggal lain, draft, atau transaksi uji tidak dikirim", async () => {
    const { notifyNewDeliveryOrder } = await import("@/lib/push/notify");
    for (const sale of [{ transactionDateKey: "2026-01-02" }, { approvalStatus: "draft" }, { isTestTransaction: true }]) {
      row = doRow(sale);
      await notifyNewDeliveryOrder("do1");
    }
    expect(sent).toHaveLength(0);
  });
});

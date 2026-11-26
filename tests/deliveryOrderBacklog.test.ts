import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

const { backlogMessage } = await import("@/lib/deliveryOrders/backlogReport");

const row = (doNumber: string, customerName: string, packed: boolean, hoursAgo: number, now: Date) => ({
  doNumber, customerName, packingStatus: packed ? "sudah" : "belum", shippingStatus: "belum",
  createdAt: new Date(now.getTime() - hoursAgo * 3_600_000)
});

describe("laporan DO belum terproses", () => {
  const now = new Date("2026-11-26T05:30:00Z");

  it("merangkum yang belum dipacking dan belum dikirim, dengan DO terlama", () => {
    const notPacked = [row("DO-1", "Bu Ani", false, 50, now), row("DO-3", "Toko B", false, 3, now)];
    const notShipped = [row("DO-2", "Pak Budi", true, 5, now)];
    const message = backlogMessage({ total: 4, notPacked, notShipped, partial: [row("DO-4", "Toko C", true, 1, now)], oldest: notPacked[0] }, "12.30", now);
    expect(message.title).toBe("4 DO belum terproses · 12.30");
    expect(message.body).toBe("2 belum dipacking: DO-1 (Bu Ani), DO-3 (Toko B). 1 belum dikirim: DO-2 (Pak Budi). 1 baru terkirim sebagian: DO-4 (Toko C). Terlama DO-1, 2 hari.");
  });

  it("memotong daftar panjang dan memberi kabar bila semua sudah selesai", () => {
    const many = Array.from({ length: 5 }, (_, i) => row(`DO-${i}`, `C${i}`, false, 2, now));
    expect(backlogMessage({ total: 5, notPacked: many, notShipped: [], partial: [], oldest: many[0] }, "15.00", now).body)
      .toBe("5 belum dipacking: DO-0 (C0), DO-1 (C1), DO-2 (C2), +2 lagi. Terlama DO-0, 2 jam.");
    expect(backlogMessage({ total: 0, notPacked: [], notShipped: [], partial: [], oldest: null }, "15.00", now).title).toBe("DO 15.00: semua sudah terproses");
  });
});

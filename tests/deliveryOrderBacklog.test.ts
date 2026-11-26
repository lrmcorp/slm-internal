import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

const { backlogMessage, announcementText } = await import("@/lib/deliveryOrders/backlogReport");

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

  it("menyusun kalimat speaker: jumlah pesanan, nama (sekali per customer), dan ajakan memproses", () => {
    const rows = [row("DO-1", "Bu Ani", false, 50, now), row("DO-2", "Toko B", true, 5, now), row("DO-3", "Bu Ani", false, 3, now)];
    const report = { total: 3, notPacked: [rows[0], rows[2]], notShipped: [rows[1]], partial: [], oldest: rows[0] };
    expect(announcementText(report)).toBe("Perhatian. Ada 3 pesanan yang belum diproses, atas nama Bu Ani dan Toko B. Mohon segera diproses. Terima kasih.");
    const single = { total: 1, notPacked: [rows[1]], notShipped: [], partial: [], oldest: rows[1] };
    expect(announcementText(single)).toBe("Perhatian. Ada 1 pesanan yang belum diproses, atas nama Toko B. Mohon segera diproses. Terima kasih.");
    const many = Array.from({ length: 7 }, (_, i) => row(`DO-${i}`, `Toko ${i}`, false, 10 - i, now));
    expect(announcementText({ total: 7, notPacked: many, notShipped: [], partial: [], oldest: many[0] }))
      .toBe("Perhatian. Ada 7 pesanan yang belum diproses, atas nama Toko 0, Toko 1, Toko 2, Toko 3, Toko 4, dan 2 lainnya. Mohon segera diproses. Terima kasih.");
    expect(announcementText({ total: 0, notPacked: [], notShipped: [], partial: [], oldest: null })).toBeNull();
  });
});

describe("pengumuman ke speaker CCTV", () => {
  it("mengirim kalimat ke server CCTV di kanal 13 dengan token SLM, dan tidak melempar error bila gagal", async () => {
    vi.resetModules();
    process.env.CCTV_BASE_URL = "https://cctv.example.test/";
    vi.doMock("@/lib/db/prisma", () => ({ prisma: {} }));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ success: true }), { status: 202 });
    });
    const { announceOnCctv } = await import("@/lib/push/notify");
    expect(await announceOnCctv("Ada 1 pesanan yang belum diproses.")).toBe("diantrekan di speaker CCTV");
    expect(calls[0].url).toBe("https://cctv.example.test/api/v1/slm/announce");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ text: "Ada 1 pesanan yang belum diproses.", channel: 13 });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["X-SLM-Token"]).toBeTruthy();
    expect(headers.Authorization).toBe(`Bearer ${headers["X-SLM-Token"]}`);

    vi.stubGlobal("fetch", async () => { throw new Error("ECONNREFUSED"); });
    expect(await announceOnCctv("x")).toBe("CCTV tidak terjangkau: ECONNREFUSED");
    vi.unstubAllGlobals();
  });
});

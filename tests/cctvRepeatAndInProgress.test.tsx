import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { cctvDetectionLog: { findFirst: mocks.findFirst } } }));
import { CCTV_REPEAT_WINDOW_MS, findRepeatDetection } from "@/lib/cctv/repeatDetection";
import { CctvDashboardWidget } from "@/components/dashboard/CctvDashboardWidget";

describe("label CCTV yang sama tidak dicatat berulang", () => {
  beforeEach(() => mocks.findFirst.mockReset());
  it("mencari catatan transaksi yang sama dalam 12 jam terakhir", async () => {
    mocks.findFirst.mockResolvedValue({ id: "log-1" });
    const now = new Date("2026-11-15T15:00:00Z");
    await expect(findRepeatDetection({ eventType: "invoice_captured", salesRecordId: "S-1", now })).resolves.toEqual({ id: "log-1" });
    const where = mocks.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ eventType: "invoice_captured", salesRecordId: "S-1" });
    expect(where.createdAt.gte.getTime()).toBe(now.getTime() - CCTV_REPEAT_WINDOW_MS);
  });
  it("tanpa transaksi maupun nomor invoice tidak menggabungkan apa pun", async () => {
    await expect(findRepeatDetection({ eventType: "packing_completed" })).resolves.toBeNull();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});

describe("dashboard menampilkan paket yang sedang dipacking", () => {
  it("label tertangkap tanpa packing selesai tampil sebagai Sedang dipacking", () => {
    const html = renderToStaticMarkup(
      <CctvDashboardWidget
        summary={{
          today: { totalPacked: 0, totalDetections: 2, totalAnomalies: 0, totalInProgress: 1 },
          recentPacked: [],
          recentInProgress: [{ id: "c1", invoiceNumber: "141126-42", customerName: "Almira", cameraName: "Camera 12", createdAt: "2026-11-15T14:21:00Z", salesRecord: null }],
          liveSystem: null,
        }}
        cameraStreams={[]}
      />,
    );
    expect(html).toContain("Sedang dipacking");
    expect(html).toContain("141126-42");
    expect(html).not.toContain("Belum ada paket yang dipacking hari ini");
  });
});

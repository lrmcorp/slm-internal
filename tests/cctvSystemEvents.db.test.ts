/** Kejadian kamera offline tidak tampil di tabel packing (jalan bila INVENTORY_TEST_DATABASE_URL diset). */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const url = process.env.INVENTORY_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("kejadian sistem CCTV (postgres)", () => {
  let store: typeof import("@/lib/cctv/store");
  let prisma: typeof import("@/lib/db/prisma").prisma;
  const tag = `SYS-${Date.now()}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ prisma } = await import("@/lib/db/prisma"));
    store = await import("@/lib/cctv/store");
    await prisma.cctvDetectionLog.createMany({ data: [
      { cameraName: `${tag} Camera 12`, eventType: "camera_offline", packingStatus: "camera_offline", matchStatus: "review", firstSeenAt: new Date() },
      { cameraName: `${tag} Camera 14`, eventType: "invoice_captured", packingStatus: "captured", matchStatus: "matched", invoiceNumber: `${tag}-INV`, firstSeenAt: new Date() }
    ] });
  });

  afterAll(async () => {
    await prisma.cctvDetectionLog.deleteMany({ where: { cameraName: { startsWith: tag } } });
  });

  it("tabel packing tanpa filter hanya berisi hasil pencocokan, filter Event tetap bisa menampilkan kamera offline", async () => {
    const all = await store.listCctvDetectionsPaginated({ search: tag, pageSize: 50 });
    expect(all.items.map((row: { eventType: string }) => row.eventType)).toEqual(["invoice_captured"]);
    const offline = await store.listCctvDetectionsPaginated({ search: tag, eventType: "camera_offline", pageSize: 50 });
    expect(offline.items.map((row: { eventType: string }) => row.eventType)).toEqual(["camera_offline"]);
  });

  it("laporan perlu ditinjau tidak memuat kamera offline", async () => {
    const report = await store.getCctvAnomaliesReport({ cameraName: tag, pageSize: 50 } as never);
    const rows = (report as { items: Array<{ eventType: string }> }).items;
    expect(rows.some((row) => row.eventType === "camera_offline")).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/cctv/client", () => ({ getCctvSystemStatus: vi.fn() }));
import { jakartaTodayRange } from "@/lib/cctv/store";

describe("hari ini CCTV menurut jam Jakarta", () => {
  it("paket jam 04.51 WIB masuk hari yang sama dengan jam 12.18 WIB", () => {
    const range = jakartaTodayRange(new Date("2026-11-16T05:18:00Z")); // 12.18 WIB
    expect(range.gte.toISOString()).toBe("2026-11-15T17:00:00.000Z"); // 00.00 WIB
    expect(range.lte.toISOString()).toBe("2026-11-16T16:59:59.999Z"); // 23.59 WIB
    const packedAt = new Date("2026-11-15T21:51:00Z"); // 04.51 WIB
    expect(packedAt >= range.gte && packedAt <= range.lte).toBe(true);
  });
  it("lewat tengah malam WIB sudah hari berikutnya", () => {
    expect(jakartaTodayRange(new Date("2026-11-16T17:30:00Z")).gte.toISOString()).toBe("2026-11-16T17:00:00.000Z");
  });
});

import { describe, expect, it } from "vitest";
import { dashboardDataFrom } from "@/lib/dashboard/dataRange";

describe("rentang data dashboard", () => {
  it("tanpa filter: 6 bulan terakhir termasuk bulan ini", () => {
    expect(dashboardDataFrom({}, "2026-11-01", "2026-11")).toBe("2026-06-01");
  });
  it("filter dari tanggal lama atau periode pembayaran lama ikut dimuat", () => {
    expect(dashboardDataFrom({ from: "2025-12-15" }, "2026-11-01", "2026-11")).toBe("2025-12-01");
    expect(dashboardDataFrom({}, "2026-01-10", "2026-11")).toBe("2026-01-10");
    expect(dashboardDataFrom({ to: "2026-03-31" }, "2026-11-01", "2026-11")).toBe("2025-10-01");
  });
  it("lintas tahun dan nilai tidak valid diabaikan", () => {
    expect(dashboardDataFrom({}, undefined, "2026-02")).toBe("2025-09-01");
    expect(dashboardDataFrom({ from: "abc" }, "zzz", "2026-11")).toBe("2026-06-01");
  });
});

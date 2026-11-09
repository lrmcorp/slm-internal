import { describe, expect, it } from "vitest";
import { cctvEnabled } from "@/lib/features";
import { visibleNavLinks, visibleNavSections } from "@/components/layout/navigation";

const hrefs = (cctv?: boolean) => visibleNavSections("OWNER", cctv === undefined ? {} : { cctv }).flatMap((g) => g.sections.flatMap((s) => s.links.map((l) => l.href)));

describe("CCTV per instance (CCTV_ENABLED)", () => {
  it("aktif kecuali diisi false", () => {
    expect(cctvEnabled({})).toBe(true);
    expect(cctvEnabled({ CCTV_ENABLED: "true" })).toBe(true);
    expect(cctvEnabled({ CCTV_ENABLED: "false" })).toBe(false);
    expect(cctvEnabled({ CCTV_ENABLED: " FALSE " })).toBe(false);
  });

  it("menu dan tab CCTV hilang bila dimatikan, menu lain tetap", () => {
    expect(hrefs()).toEqual(expect.arrayContaining(["/cctv-monitoring", "/reports/cctv"]));
    const off = hrefs(false);
    expect(off.some((h) => h.startsWith("/cctv-monitoring") || h.startsWith("/reports/cctv"))).toBe(false);
    expect(off).toEqual(expect.arrayContaining(["/dashboard", "/reports", "/inventory/barang-keluar", "/settings"]));
    expect(visibleNavLinks("OWNER", { cctv: false }).length).toBe(visibleNavLinks("OWNER").length - hrefs().filter((h) => h.includes("cctv")).length);
  });
});

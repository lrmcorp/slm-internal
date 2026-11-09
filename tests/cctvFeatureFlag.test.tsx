import { describe, expect, it } from "vitest";
import { cctvEnabled } from "@/lib/features";
import { visibleNavLinks, visibleNavSections } from "@/components/layout/navigation";

const hrefs = (cctv?: boolean) => visibleNavSections("OWNER", cctv === undefined ? {} : { cctv }).flatMap((g) => g.sections.flatMap((s) => s.links.map((l) => l.href)));

describe("CCTV hanya untuk domain SLM", () => {
  it("hanya aktif di domain SLM", () => {
    expect(cctvEnabled({}, "slm.lrmint.xyz")).toBe(true);
    expect(cctvEnabled({}, "SLM.lrmint.xyz:443")).toBe(true);
    expect(cctvEnabled({}, "lcr.lrmint.xyz")).toBe(false);
    expect(cctvEnabled({ CCTV_ENABLED: "true" }, "ankjy.lrmint.xyz")).toBe(false);
    expect(cctvEnabled({ CCTV_ENABLED: "false" }, "slm.lrmint.xyz")).toBe(false);
    expect(cctvEnabled({ CCTV_ENABLED: " FALSE " }, "slm.lrmint.xyz")).toBe(false);
    expect(cctvEnabled({ CCTV_ALLOWED_HOSTS: "a.test, b.test" }, "b.test")).toBe(true);
    expect(cctvEnabled({ CCTV_ALLOWED_HOSTS: "a.test" }, "slm.lrmint.xyz")).toBe(false);
  });

  it("tanpa request (skrip, job) hanya aktif bila CCTV_ENABLED=true", () => {
    expect(cctvEnabled({})).toBe(false);
    expect(cctvEnabled({ CCTV_ENABLED: "true" })).toBe(true);
  });

  it("menu dan tab CCTV hilang bila dimatikan, menu lain tetap", () => {
    expect(hrefs()).toEqual(expect.arrayContaining(["/cctv-monitoring", "/reports/cctv"]));
    const off = hrefs(false);
    expect(off.some((h) => h.startsWith("/cctv-monitoring") || h.startsWith("/reports/cctv"))).toBe(false);
    expect(off).toEqual(expect.arrayContaining(["/dashboard", "/reports", "/inventory/barang-keluar", "/settings"]));
    expect(visibleNavLinks("OWNER", { cctv: false }).length).toBe(visibleNavLinks("OWNER").length - hrefs().filter((h) => h.includes("cctv")).length);
  });
});

describe("fitur per instance: DO dan notifikasi", () => {
  it("DO aktif kecuali DELIVERY_ORDERS_ENABLED=false, menu DO ikut hilang", async () => {
    const { deliveryOrdersEnabled } = await import("@/lib/features");
    expect(deliveryOrdersEnabled({})).toBe(true);
    expect(deliveryOrdersEnabled({ DELIVERY_ORDERS_ENABLED: "false" })).toBe(false);
    const links = (o: { deliveryOrders?: boolean }) => visibleNavLinks("OWNER", o).map((l) => l.href);
    expect(links({})).toContain("/delivery-orders");
    expect(links({ deliveryOrders: false })).not.toContain("/delivery-orders");
  });

  it("PUSH_ENABLED=false mematikan notifikasi walau kunci VAPID terisi", async () => {
    const { pushConfig } = await import("@/lib/push/config");
    const keys = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" };
    expect(pushConfig(keys).enabled).toBe(true);
    expect(pushConfig({ ...keys, PUSH_ENABLED: "false" }).enabled).toBe(false);
  });
});

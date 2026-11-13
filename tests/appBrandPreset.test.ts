import { afterEach, describe, expect, it, vi } from "vitest";

describe("preset brand per instance", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("SLMJ memakai logo PT Serba Lancar Mekarindo dan biru navy logo", async () => {
    vi.stubEnv("APP_BRAND_NAME", "SLMJ");
    const { getAppBrand, brandHex } = await import("@/lib/appBrand");
    const brand = getAppBrand();
    expect(brand).toMatchObject({ accent: "navy", companyName: "PT Serba Lancar Mekarindo", iconSlug: "slmj" });
    expect(brand.logo?.full).toBe("/brand/slmj/logo.png");
    expect(brandHex(brand)).toBe("#002a6d");
  });

  it("env tetap menang atas preset; instance lain tanpa logo gambar", async () => {
    vi.stubEnv("APP_BRAND_NAME", "SLMJ");
    vi.stubEnv("APP_BRAND_ACCENT", "sky");
    const { getAppBrand } = await import("@/lib/appBrand");
    expect(getAppBrand().accent).toBe("sky");
    vi.stubEnv("APP_BRAND_NAME", "SLM");
    vi.stubEnv("APP_BRAND_ACCENT", "");
    expect(getAppBrand()).toMatchObject({ accent: null, logo: null, iconSlug: "slm" });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

describe("preset brand per instance", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("SLMJ memakai logo PT Serba Lancar Mekarindo dan biru navy logo", async () => {
    vi.stubEnv("APP_BRAND_NAME", "SLMJ");
    const { getAppBrand, brandHex } = await import("@/lib/appBrand");
    const brand = getAppBrand();
    expect(brand).toMatchObject({ accent: "navy", companyName: "PT Serba Lancar Mekarindo", iconSlug: "slmj" });
    expect(brand.logo?.full).toMatch(/^\/brand\/slmj\/logo\.png\?v=/);
    expect(brandHex(brand)).toBe("#002a6d");
  });

  it("env tetap menang atas preset; instance lain tanpa logo gambar", async () => {
    vi.stubEnv("APP_BRAND_NAME", "SLMJ");
    vi.stubEnv("APP_BRAND_ACCENT", "sky");
    const { getAppBrand } = await import("@/lib/appBrand");
    expect(getAppBrand().accent).toBe("sky");
    vi.stubEnv("APP_BRAND_NAME", "ANKJY");
    vi.stubEnv("APP_BRAND_INITIALS", "AJ");
    vi.stubEnv("APP_BRAND_ACCENT", "");
    expect(getAppBrand()).toMatchObject({ accent: null, logo: null, iconSlug: "ankjy" });
  });
});

describe("preset SLM", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("SLM (bawaan) memakai logo mark dan hijau zaitun logo", async () => {
    vi.stubEnv("APP_BRAND_NAME", "SLM");
    const { getAppBrand, brandHex } = await import("@/lib/appBrand");
    const brand = getAppBrand();
    expect(brand).toMatchObject({ accent: "olive", iconSlug: "slm", logo: { mark: expect.stringMatching(/^\/brand\/slm\/mark\.png\?v=/) } });
    expect(brandHex(brand)).toBe("#404731");
  });
});

describe("preset SLMJ dari env lama instance lcr", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("inisial LCR / nama Serba Lancar Mekarindo juga mengaktifkan logo SLMJ", async () => {
    vi.stubEnv("APP_BRAND_NAME", "Serba Lancar Mekarindo");
    vi.stubEnv("APP_BRAND_INITIALS", "LCR");
    vi.stubEnv("APP_BRAND_TITLE", "PT. Serba Lancar Mekarindo");
    const { getAppBrand } = await import("@/lib/appBrand");
    expect(getAppBrand()).toMatchObject({ accent: "navy", iconSlug: "slmj", logo: { full: expect.stringMatching(/^\/brand\/slmj\/logo\.png\?v=/) } });
  });
});

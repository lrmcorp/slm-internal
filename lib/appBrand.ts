import { cctvEnabled, deliveryOrdersEnabled } from "@/lib/features";

/**
 * Identitas aplikasi. Satu image dipakai beberapa instance (SLM, SLMJ, ANKJY), jadi identitas dibaca
 * dari environment server saat aplikasi berjalan, bukan saat build.
 *   APP_BRAND_NAME      nama singkat di menu (default NEXT_PUBLIC_APP_NAME atau "SLM")
 *   APP_BRAND_INITIALS  teks logo kotak (default "SLM")
 *   APP_BRAND_TITLE     judul tab & halaman login (default "<nama> Internal App")
 *   APP_COMPANY_NAME    nama badan usaha di kop laporan & login (default "Aneka Jaya / SLM")
 * Komponen client tidak bisa membaca env server: pakai useBrand() dari components/brand/BrandProvider.
 */
export type AppBrand = {
  name: string; initials: string; title: string; companyName: string; accent: string | null; cctvEnabled: boolean; deliveryOrdersEnabled: boolean;
  /** Logo gambar instance (menggantikan kotak inisial). mark = logo kecil di menu, full = logo lengkap di login. */
  logo?: { mark: string; full: string } | null;
  /** Nama file ikon layar utama di public/pwa/<iconSlug>-<ukuran>.png. */
  iconSlug?: string;
};

/**
 * Preset identitas per instance. Aktif bila APP_BRAND_PRESET diisi, atau nama/inisial brand sama dengan kunci preset.
 * Nilai env APP_BRAND_* tetap menang atas preset.
 */
const PRESETS: Record<string, { accent: string; companyName?: string; logo: { mark: string; full: string }; aliases: string[] }> = {
  // SLM (slm.lrmslm.com): logo mark hijau zaitun #404731.
  slm: { accent: "olive", logo: { mark: "/brand/slm/mark.png", full: "/brand/slm/mark.png" }, aliases: ["slm"] },
  // SLMJ (slmj.lrmslm.com, dulu lcr): logo PT Serba Lancar Mekarindo, biru navy #002A6D sesuai logo.
  slmj: {
    accent: "navy", companyName: "PT Serba Lancar Mekarindo", logo: { mark: "/brand/slmj/mark.png", full: "/brand/slmj/logo.png" },
    aliases: ["slmj", "lcr", "serba lancar mekarindo", "pt serba lancar mekarindo"]
  }
};

/**
 * Kunci preset dari nilai pertama yang cocok, berurutan: APP_BRAND_PRESET, nama, inisial, judul
 * (tanpa titik, huruf kecil). Urutan ini membuat SLMJ tidak tertukar dengan SLM.
 */
function findPreset(values: string[]) {
  for (const raw of values) {
    const v = raw.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
    if (!v) continue;
    const key = Object.keys(PRESETS).find((k) => v === k || PRESETS[k].aliases.includes(v));
    if (key) return key;
  }
  return undefined;
}

const read = (key: string) => (typeof process !== "undefined" ? (process.env[key] || "").trim() : "");

export function getAppBrand(): AppBrand {
  const name = read("APP_BRAND_NAME") || read("NEXT_PUBLIC_APP_NAME") || "SLM";
  const initials = read("APP_BRAND_INITIALS") || "SLM";
  // Inisial bawaan ("SLM") tidak ikut menentukan preset; hanya inisial yang diisi di env.
  const presetKey = findPreset([read("APP_BRAND_PRESET"), name, read("APP_BRAND_INITIALS"), read("APP_BRAND_TITLE")]);
  const preset = presetKey ? PRESETS[presetKey] : null;
  return {
    name,
    initials,
    title: read("APP_BRAND_TITLE") || `${name} Internal App`,
    companyName: read("APP_COMPANY_NAME") || preset?.companyName || "Aneka Jaya / SLM",
    accent: read("APP_BRAND_ACCENT") || preset?.accent || null,
    // Versi di alamat logo supaya Cloudflare/browser langsung memakai logo baru.
    logo: preset?.logo ? { mark: `${preset.logo.mark}?v=${ICON_VERSION}`, full: `${preset.logo.full}?v=${ICON_VERSION}` } : null,
    iconSlug: presetKey || name.trim().toLowerCase().replace(/[^a-z0-9-]/g, ""),
    cctvEnabled: cctvEnabled(),
    deliveryOrdersEnabled: deliveryOrdersEnabled()
  };
}

/**
 * Versi ikon (favicon, ikon layar utama, splash). Naikkan setiap logo/ikon berubah: alamat ikon ikut berubah
 * sehingga cache Cloudflare dan browser langsung memakai ikon baru.
 */
export const ICON_VERSION = "2026-11-13c";

/** Alamat ikon dengan versi + instance, mis. /pwa-icon/180?v=2026-11-13-slm. */
export function iconUrl(path: string, brand: Pick<AppBrand, "iconSlug"> = getAppBrand()) {
  return `${path}?v=${ICON_VERSION}-${brand.iconSlug || "app"}`;
}

/** Warna utama brand (hex) untuk ikon dan warna bilah status di HP. */
export function brandHex(brand: Pick<AppBrand, "accent"> = getAppBrand()) {
  const accentHex: Record<string, string> = { sky: "#0284c7", navy: "#002a6d", olive: "#404731" };
  return (brand.accent && accentHex[brand.accent]) || "#059669";
}

const brand = getAppBrand();
/** Hanya untuk kode server. */
export const APP_BRAND_NAME = brand.name;
export const APP_BRAND_INITIALS = brand.initials;
export const APP_BRAND_TITLE = brand.title;
export const APP_COMPANY_NAME = brand.companyName;
export const EXTERNAL_ERP_NAME = "Aneka Jaya ERP";

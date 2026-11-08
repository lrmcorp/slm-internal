/**
 * Identitas aplikasi. Satu image dipakai beberapa instance (SLM, SLMJ, ANKJY), jadi identitas dibaca
 * dari environment server saat aplikasi berjalan, bukan saat build.
 *   APP_BRAND_NAME      nama singkat di menu (default NEXT_PUBLIC_APP_NAME atau "SLM")
 *   APP_BRAND_INITIALS  teks logo kotak (default "SLM")
 *   APP_BRAND_TITLE     judul tab & halaman login (default "<nama> Internal App")
 *   APP_COMPANY_NAME    nama badan usaha di kop laporan & login (default "Aneka Jaya / SLM")
 * Komponen client tidak bisa membaca env server: pakai useBrand() dari components/brand/BrandProvider.
 */
export type AppBrand = { name: string; initials: string; title: string; companyName: string; accent: string | null };

const read = (key: string) => (typeof process !== "undefined" ? (process.env[key] || "").trim() : "");

export function getAppBrand(): AppBrand {
  const name = read("APP_BRAND_NAME") || read("NEXT_PUBLIC_APP_NAME") || "SLM";
  return {
    name,
    initials: read("APP_BRAND_INITIALS") || "SLM",
    title: read("APP_BRAND_TITLE") || `${name} Internal App`,
    companyName: read("APP_COMPANY_NAME") || "Aneka Jaya / SLM",
    accent: read("APP_BRAND_ACCENT") || null
  };
}

const brand = getAppBrand();
/** Hanya untuk kode server. */
export const APP_BRAND_NAME = brand.name;
export const APP_BRAND_INITIALS = brand.initials;
export const APP_BRAND_TITLE = brand.title;
export const APP_COMPANY_NAME = brand.companyName;
export const EXTERNAL_ERP_NAME = "Aneka Jaya ERP";

import { brandHex, getAppBrand } from "@/lib/appBrand";

export const dynamic = "force-dynamic";

/** Manifest per instance (SLM, SLMJ, ANKJY) supaya nama & ikon di layar utama HP sesuai instance-nya. */
export function GET() {
  const brand = getAppBrand();
  const manifest = {
    name: brand.title,
    short_name: brand.name,
    description: `Aplikasi operasional internal ${brand.companyName}`,
    id: "/",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f6f6f5",
    theme_color: brandHex(brand),
    lang: "id",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" },
  });
}

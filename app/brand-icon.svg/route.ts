import { readFile } from "node:fs/promises";
import path from "node:path";
import { brandHex, getAppBrand } from "@/lib/appBrand";

export const dynamic = "force-dynamic";

const escapeXml = (value: string) => value.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function GET() {
  const brand = getAppBrand();
  // Instance dengan logo (SLM, SLMJ): favicon dari logo, public/pwa/<slug>-fav64.png.
  if (brand.logo && brand.iconSlug) {
    const png = await readFile(path.join(process.cwd(), "public", "pwa", `${brand.iconSlug}-fav64.png`)).catch(() => null);
    if (png) return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "public, max-age=3600" } });
  }
  const initials = escapeXml(brand.initials.slice(0, 4));
  const fontSize = initials.length > 3 ? 10 : 12;
  const bg = brandHex(brand);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><rect width="32" height="32" rx="7" fill="${bg}"/>`;
  const svgTail = `<text x="16" y="21" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="-0.5px" fill="#ffffff" text-anchor="middle">${initials}</text></svg>`;
  return new Response(svg + svgTail, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" } });
}

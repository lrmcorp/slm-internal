import { getAppBrand } from "@/lib/appBrand";

export const dynamic = "force-dynamic";

const escapeXml = (value: string) => value.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function GET() {
  const brand = getAppBrand();
  const initials = escapeXml(brand.initials.slice(0, 4));
  const fontSize = initials.length > 3 ? 10 : 12;
  const accentHex: Record<string, string> = { sky: "#0284c7" };
  const bg = (brand.accent && accentHex[brand.accent]) || "#059669";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32"><rect width="32" height="32" rx="7" fill="${bg}"/>`;
  const svgTail = `<text x="16" y="21" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" font-size="${fontSize}" font-weight="900" letter-spacing="-0.5px" fill="#ffffff" text-anchor="middle">${initials}</text></svg>`;
  return new Response(svg + svgTail, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" } });
}

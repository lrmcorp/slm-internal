import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { brandHex, getAppBrand } from "@/lib/appBrand";

export const dynamic = "force-dynamic";

const SIZES = new Set([180, 192, 512]);

/** Logo khusus layar utama per instance: public/pwa/<nama-brand>-<ukuran>.png (mis. slm-180.png). */
async function customIcon(brandName: string, size: number) {
  const slug = brandName.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!slug) return null;
  return readFile(path.join(process.cwd(), "public", "pwa", `${slug}-${size}.png`)).catch(() => null);
}

/** Ikon PNG layar utama (iPhone tidak memakai SVG). Tanpa logo khusus: inisial brand di atas warna brand. */
export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!SIZES.has(size)) return new Response("Not found", { status: 404 });
  const brand = getAppBrand();
  const custom = await customIcon(brand.name, size);
  if (custom) {
    return new Response(new Uint8Array(custom), { headers: { "content-type": "image/png", "cache-control": "public, max-age=3600" } });
  }
  const initials = brand.initials.slice(0, 4);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: brandHex(brand), color: "#ffffff", fontSize: Math.round(size * (initials.length > 3 ? 0.28 : 0.34)), fontWeight: 800, letterSpacing: -size * 0.01 }}>
        {initials}
      </div>
    ),
    { width: size, height: size, headers: { "cache-control": "public, max-age=3600" } },
  );
}

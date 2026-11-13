import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { brandHex, getAppBrand } from "@/lib/appBrand";
import { IPHONE_SPLASH_SCREENS, splashKey } from "@/lib/pwa/splash";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(IPHONE_SPLASH_SCREENS.map(splashKey));

/** Splash screen iPhone saat aplikasi layar utama dibuka (pengganti layar hitam): logo di tengah latar putih. */
export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = (await params).size;
  if (!ALLOWED.has(size)) return new Response("Not found", { status: 404 });
  const [width, height] = size.split("x").map(Number);
  const brand = getAppBrand();
  const slug = brand.iconSlug || brand.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  const custom = slug ? await readFile(path.join(process.cwd(), "public", "pwa", `${slug}-512.png`)).catch(() => null) : null;
  const logo = Math.round(width * 0.36);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" }}>
        {custom ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`data:image/png;base64,${custom.toString("base64")}`} width={logo} height={logo} alt="" />
        ) : (
          <div style={{ width: logo, height: logo, borderRadius: logo * 0.22, display: "flex", alignItems: "center", justifyContent: "center", background: brandHex(brand), color: "#ffffff", fontSize: Math.round(logo * 0.3), fontWeight: 800 }}>
            {brand.initials.slice(0, 4)}
          </div>
        )}
      </div>
    ),
    { width, height, headers: { "cache-control": "public, max-age=86400" } },
  );
}

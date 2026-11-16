import { NextRequest, NextResponse } from "next/server";
import { cctvEnabled, requestHost } from "@/lib/features";
import { CCTV_BASE_URL, CCTV_TOKEN, matchesToken } from "@/lib/cctv/client";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const FILE_PATTERN = /^(stream\.m3u8|segment[0-9]+\.ts)$/;

/**
 * Live HLS dari server CCTV, diteruskan apa adanya (tanpa decode) supaya dashboard memutar video
 * sungguhan, bukan foto per 5 detik. Encoder di server CCTV baru menyala saat playlist diminta,
 * jadi permintaan pertama bisa dijawab 503 + Retry-After; pemutar mencoba lagi sendiri.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ cameraId: string; file: string }> }) {
  if (!cctvEnabled(process.env, requestHost(req.headers) || req.nextUrl.hostname)) {
    return new NextResponse("Not Found", { status: 404 });
  }
  const user = await getCurrentUser();
  const tokenOk = matchesToken(req.headers.get("x-cctv-token"));
  if (!tokenOk && user.id === "unauthenticated") return new NextResponse("Unauthorized", { status: 401 });
  if (!tokenOk && user.role !== "OWNER") {
    return new NextResponse("Akses siaran langsung CCTV terbatas untuk Super Admin (Owner).", { status: 403 });
  }

  const { cameraId, file } = await params;
  const cleanId = cameraId.replace(/^cam-?/i, "");
  if (!/^[0-9]{1,6}$/.test(cleanId) || !FILE_PATTERN.test(file)) {
    return new NextResponse("Not Found", { status: 404 });
  }
  const base = CCTV_BASE_URL.replace(/\/+$/, "");
  if (!base) return new NextResponse("CCTV belum dikonfigurasi.", { status: 503 });

  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort());
  try {
    const upstream = await fetch(`${base}/cameras/${encodeURIComponent(cleanId)}/live/${file}`, {
      headers: { Authorization: `Bearer ${CCTV_TOKEN}`, "X-CCTV-Token": CCTV_TOKEN, Accept: "*/*" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!upstream.ok || !upstream.body) {
      const status = upstream.status === 404 ? 404 : 503;
      return new NextResponse(null, {
        status,
        headers: { "Retry-After": upstream.headers.get("retry-after") || "2", "Cache-Control": "no-store" },
      });
    }
    return new NextResponse(upstream.body as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": file.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp2t",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") return new NextResponse(null, { status: 499 });
    return new NextResponse(null, { status: 503, headers: { "Retry-After": "3", "Cache-Control": "no-store" } });
  }
}

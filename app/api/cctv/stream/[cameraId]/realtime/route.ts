import { NextRequest, NextResponse } from "next/server";
import { cctvEnabled, requestHost } from "@/lib/features";
import { CCTV_BASE_URL, CCTV_TOKEN, matchesToken } from "@/lib/cctv/client";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * Live realtime: MP4 bertahap dari relay go2rtc di server CCTV, diteruskan apa adanya (tanpa decode).
 * Jedanya sekitar 1 detik dan langsung tampil. Bila server CCTV belum punya relay (404/503), pemutar
 * kembali ke HLS lewat /hls/stream.m3u8.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ cameraId: string }> }) {
  if (!cctvEnabled(process.env, requestHost(req.headers) || req.nextUrl.hostname)) {
    return new NextResponse("Not Found", { status: 404 });
  }
  const user = await getCurrentUser();
  const tokenOk = matchesToken(req.headers.get("x-cctv-token"));
  if (!tokenOk && user.id === "unauthenticated") return new NextResponse("Unauthorized", { status: 401 });
  if (!tokenOk && user.role !== "OWNER") {
    return new NextResponse("Akses siaran langsung CCTV terbatas untuk Super Admin (Owner).", { status: 403 });
  }

  const { cameraId } = await params;
  const cleanId = cameraId.replace(/^cam-?/i, "");
  if (!/^[0-9]{1,6}$/.test(cleanId)) return new NextResponse("Not Found", { status: 404 });
  const base = CCTV_BASE_URL.replace(/\/+$/, "");
  if (!base) return new NextResponse("CCTV belum dikonfigurasi.", { status: 503 });

  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort());
  try {
    const upstream = await fetch(`${base}/cameras/${encodeURIComponent(cleanId)}/realtime`, {
      headers: { Authorization: `Bearer ${CCTV_TOKEN}`, "X-CCTV-Token": CCTV_TOKEN, Accept: "video/mp4" },
      signal: controller.signal,
      cache: "no-store",
      redirect: "manual",
    });
    const type = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !upstream.body || !type.startsWith("video/mp4")) {
      controller.abort();
      return new NextResponse(null, { status: upstream.status === 404 ? 404 : 503, headers: { "Cache-Control": "no-store" } });
    }
    return new NextResponse(upstream.body as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": type.replace(/;\s*charset=[^;]+/i, ""),
        "Cache-Control": "private, no-store",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") return new NextResponse(null, { status: 499 });
    return new NextResponse(null, { status: 503, headers: { "Retry-After": "3", "Cache-Control": "no-store" } });
  }
}

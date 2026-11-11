import { cctvEnabled, requestHost } from "@/lib/features";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentRole } from "@/lib/auth/session";
import { can, primaryRole } from "@/lib/auth/roles";
import { getConfiguredCameraStreams } from "@/lib/cctv/streams";
import { getCctvSystemStatus } from "@/lib/cctv/client";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ cameraId: string }> }
) {
  if (!cctvEnabled(process.env, requestHost(req.headers) || req.nextUrl.hostname)) return new NextResponse("Not Found", { status: 404 });
  const access = await getCurrentRole();
  const role = primaryRole(access);
  if (role !== "OWNER" || !can(access, "dashboard.view")) {
    return NextResponse.json(
      { error: "Forbidden: Akses siaran langsung CCTV terbatas untuk Super Admin (Owner)." },
      { status: 403 }
    );
  }

  const { cameraId } = await params;
  const status = await getCctvSystemStatus().catch(() => null);
  const streams = getConfiguredCameraStreams(status?.cameras);

  const matched = streams.find(
    (s) => String(s.id).toLowerCase() === cameraId.toLowerCase()
  );

  if (!matched) {
    return NextResponse.json(
      { error: `Kamera dengan ID '${cameraId}' tidak ditemukan.` },
      { status: 404 }
    );
  }

  return NextResponse.json({
    camera: matched,
    systemStatus: status?.status || "offline",
    serverTime: status?.cctv_time || new Date().toISOString(),
  });
}

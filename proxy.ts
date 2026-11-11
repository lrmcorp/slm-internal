import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { can, landingPageForRole } from "@/lib/auth/roles";
import { resolveAuthProvider, resolveRequestRole, resolveRequestUser } from "@/lib/auth/request";
import { OWNER_IDLE_TTL_SECONDS, readSessionToken, renewedOwnerToken, withinAccessHours } from "@/lib/auth/sessionToken";

const LOCAL_SESSION_COOKIE = "aneka_jaya_session";
const ANIKA_ERP_TOKEN_COOKIE = "aneka_jaya_erp_token";

const PROTECTED: Array<{ path: string; permission: Parameters<typeof can>[1] | Parameters<typeof can>[1][] }> = [
  { path: "/dashboard", permission: "dashboard.view" },
  { path: "/reports", permission: "reports.view" },
  { path: "/settings", permission: "settings.view" },
  { path: "/audit-trail", permission: "audit.view" },
  { path: "/erp-sync", permission: "erp_sync.retry" },
  { path: "/approval", permission: "approval.view" },
  { path: "/tempo", permission: ["tempo.view", "tempo.view_due"] },
  { path: "/penjualan", permission: "penjualan.create" },
  { path: "/kas-bank", permission: "cashbank.manage" },
  { path: "/pengeluaran/input", permission: "pengeluaran.create" },
  { path: "/pengeluaran", permission: "pengeluaran.view" },
  { path: "/barang", permission: "stock.view" },
  { path: "/stok-barang", permission: "stock.view" },
  { path: "/delivery-orders", permission: "do.view" },
  { path: "/sdm", permission: "sdm.view" },
  { path: "/akuntansi/coa", permission: "accounting.coa.manage" },
  { path: "/akuntansi", permission: "accounting.view" },
  { path: "/pembelian", permission: "purchasing.view" },
  { path: "/inventory/barang-keluar", permission: ["penjualan.create", "reports.view"] },
  { path: "/inventory/mutasi", permission: "inventory.movement.view" },
  { path: "/inventory/transfer", permission: "inventory.transfer" },
  { path: "/inventory/barang-masuk", permission: "inventory.receive" },
  { path: "/inventory/opname", permission: "inventory.opname" },
  { path: "/inventory/adjustment", permission: "inventory.adjust" },
  { path: "/inventory/import", permission: "inventory.import" },
  { path: "/inventory/produk", permission: "inventory.master" },
  { path: "/inventory/lokasi", permission: "inventory.location" },
  { path: "/inventory", permission: "inventory.stock.view" },
  { path: "/gudang/permintaan", permission: "gudang.request.create" },
  { path: "/gudang/laporan", permission: "gudang.report.view" },
  { path: "/gudang", permission: "gudang.request.process" },
];

/**
 * Super Admin tetap login selama aktif: setiap buka aplikasi atau pindah menu memperpanjang sesi 24 jam.
 * Tidak ada aktivitas 24 jam: cookie habis dan harus login lagi.
 */
function readRoleSafely(request: NextRequest) {
  try {
    return readSessionToken(request.cookies.get(LOCAL_SESSION_COOKIE)?.value)?.role;
  } catch {
    return undefined;
  }
}

function outsideAccessHours(request: NextRequest) {
  try {
    const session = readSessionToken(request.cookies.get(LOCAL_SESSION_COOKIE)?.value);
    // Token lama tanpa role diperiksa di server (getCurrentUser) memakai role dari database.
    return Boolean(session?.role) && !withinAccessHours(session!.role);
  } catch {
    return false;
  }
}

function withOwnerSessionRenewed(request: NextRequest, response: NextResponse) {
  const token = renewedOwnerToken(request.cookies.get(LOCAL_SESSION_COOKIE)?.value);
  if (!token) return response;
  const base = { sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: OWNER_IDLE_TTL_SECONDS };
  response.cookies.set(LOCAL_SESSION_COOKIE, token, { ...base, httpOnly: true });
  for (const name of [ANIKA_ERP_TOKEN_COOKIE, "aneka_jaya_role"]) {
    const value = request.cookies.get(name)?.value;
    if (value) response.cookies.set(name, value, { ...base, httpOnly: name !== "aneka_jaya_role" });
  }
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/") || pathname.startsWith("/uploads/") || pathname.startsWith("/downloads/") || pathname === "/" || pathname === "/no-access" || pathname === "/login" || pathname === "/favicon.ico" || pathname === "/icon.svg" || pathname === "/brand-icon.svg" || pathname === "/manifest.webmanifest" || pathname === "/sw.js" || pathname.startsWith("/pwa-icon/") || pathname.startsWith("/pwa-splash/")) return NextResponse.next();
  const provider = resolveAuthProvider();
  const trustedHeaderMode = provider === "trusted_header";
  const localCredentialsMode = provider === "local_credentials" || provider === "anika_erp";
  const missingErpSession = provider === "anika_erp" && !request.cookies.get(ANIKA_ERP_TOKEN_COOKIE)?.value;
  const user = trustedHeaderMode ? resolveRequestUser(request) : null;
  if (trustedHeaderMode && user?.id === "unauthenticated") return NextResponse.redirect(new URL("/login", request.url));
  if (trustedHeaderMode) return NextResponse.next();
  if (localCredentialsMode && (!request.cookies.get(LOCAL_SESSION_COOKIE)?.value || missingErpSession)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (localCredentialsMode && outsideAccessHours(request)) {
    const role = readRoleSafely(request);
    const res = NextResponse.redirect(new URL(`/login?jam=${role ?? "1"}`, request.url));
    res.cookies.set(LOCAL_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }
  if (localCredentialsMode) return withOwnerSessionRenewed(request, NextResponse.next());
  const role = resolveRequestRole(request);
  for (const rule of PROTECTED) {
    if (pathname === rule.path || pathname.startsWith(`${rule.path}/`)) {
      const allowed = Array.isArray(rule.permission) ? rule.permission.some((p) => can(role, p)) : can(role, rule.permission);
      if (!allowed) {
        const landing = landingPageForRole(role);
        return NextResponse.redirect(new URL(landing === pathname ? "/no-access" : landing, request.url));
      }
      break;
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|brand-icon.svg|manifest.webmanifest|sw.js|pwa-icon|pwa-splash|uploads).*)"] };

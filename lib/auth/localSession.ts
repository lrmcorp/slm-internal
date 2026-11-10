import "server-only";
import { cookies } from "next/headers";
import { ROLE_COOKIE, type Role } from "./roles";
import { LOCAL_SESSION_COOKIE, createSessionToken, readSessionToken, sessionTtlFor } from "./sessionToken";

export { LOCAL_SESSION_COOKIE, createSessionToken, readSessionToken };

export async function setLocalSessionCookie(externalId: string, role?: Role) {
  const cookieStore = await cookies();
  const ttl = sessionTtlFor(role);
  cookieStore.set(LOCAL_SESSION_COOKIE, createSessionToken(externalId, role), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttl
  });
  if (role) {
    cookieStore.set(ROLE_COOKIE, role, {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ttl
    });
  }
  cookieStore.set("aneka_jaya_erp_token", `local-session-${externalId}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttl
  });
}

export async function clearLocalSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(LOCAL_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}

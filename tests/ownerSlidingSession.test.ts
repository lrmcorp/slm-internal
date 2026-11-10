import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => { process.env.AUTH_SESSION_SECRET ||= "test-secret"; });

describe("sesi Super Admin bergeser 24 jam", () => {
  it("Super Admin 24 jam, role lain 12 jam sejak login", async () => {
    const { createSessionToken, readSessionToken } = await import("@/lib/auth/sessionToken");
    const now = Math.floor(Date.now() / 1000);
    expect(readSessionToken(createSessionToken("o", "OWNER"))!.exp - now).toBeGreaterThan(60 * 60 * 23);
    const fin = readSessionToken(createSessionToken("f", "FINANCE"))!;
    expect(fin.exp - now).toBeLessThanOrEqual(60 * 60 * 12);
    expect(fin.role).toBe("FINANCE");
  });

  it("aktivitas memperpanjang sesi Super Admin, paling sering tiap 5 menit", async () => {
    const { createSessionToken, readSessionToken, renewedOwnerToken } = await import("@/lib/auth/sessionToken");
    const token = createSessionToken("o", "OWNER");
    expect(renewedOwnerToken(token)).toBeNull();
    const later = Date.now() + 6 * 60 * 60 * 1000;
    const renewed = renewedOwnerToken(token, later);
    expect(renewed).not.toBeNull();
    expect(readSessionToken(renewed)!.exp).toBeGreaterThan(readSessionToken(token)!.exp);
    expect(readSessionToken(renewed)!.role).toBe("OWNER");
  });

  it("role lain, token tanpa role, token palsu, dan token habis tidak diperpanjang", async () => {
    const { createSessionToken, renewedOwnerToken } = await import("@/lib/auth/sessionToken");
    const later = Date.now() + 6 * 60 * 60 * 1000;
    expect(renewedOwnerToken(createSessionToken("f", "FINANCE"), later)).toBeNull();
    expect(renewedOwnerToken(createSessionToken("o"), later)).toBeNull();
    const [payload] = createSessionToken("x", "FINANCE").split(".");
    const forged = Buffer.from(JSON.stringify({ externalId: "x", role: "OWNER", exp: Math.floor(Date.now() / 1000) + 100 })).toString("base64url");
    expect(renewedOwnerToken(`${forged}.${payload}`, later)).toBeNull();
    expect(renewedOwnerToken(undefined)).toBeNull();
  });
});

import { describe, expect, it, beforeAll } from "vitest";

beforeAll(() => { process.env.AUTH_SESSION_SECRET ||= "test-secret"; });
const wib = (hhmm: string) => Date.parse(`2026-11-10T${hhmm}:00+07:00`);
const env = { ACCESS_HOURS: "08:00-18:00" };

describe("jam akses selain Super Admin", () => {
  it("hanya 08.00 sampai sebelum 18.00 WIB; Super Admin kapan saja", async () => {
    const { withinAccessHours } = await import("@/lib/auth/sessionToken");
    expect(withinAccessHours("FINANCE", wib("07:59"), env)).toBe(false);
    expect(withinAccessHours("FINANCE", wib("08:00"), env)).toBe(true);
    expect(withinAccessHours("ADMIN", wib("17:59"), env)).toBe(true);
    expect(withinAccessHours("SUPERVISOR", wib("18:00"), env)).toBe(false);
    expect(withinAccessHours("DELIVERY_DRIVER", wib("23:30"), env)).toBe(false);
    expect(withinAccessHours("OWNER", wib("23:30"), env)).toBe(true);
    expect(withinAccessHours("OWNER", wib("03:00"), env)).toBe(true);
  });

  it("ACCESS_HOURS bisa diubah atau dimatikan per instance", async () => {
    const { withinAccessHours, accessHoursLabel } = await import("@/lib/auth/sessionToken");
    expect(withinAccessHours("FINANCE", wib("19:00"), { ACCESS_HOURS: "off" })).toBe(true);
    expect(withinAccessHours("FINANCE", wib("07:30"), { ACCESS_HOURS: "07:00-16:00" })).toBe(true);
    expect(withinAccessHours("FINANCE", wib("16:30"), { ACCESS_HOURS: "07:00-16:00" })).toBe(false);
    expect(accessHoursLabel({})).toBe("08.00–18.00 WIB");
    expect(accessHoursLabel({ ACCESS_HOURS: "off" })).toBeNull();
  });

  it("sesi selain Super Admin habis jam 18.00 WIB di hari yang sama", async () => {
    const { createSessionToken, readSessionToken } = await import("@/lib/auth/sessionToken");
    const prev = process.env.ACCESS_HOURS;
    process.env.ACCESS_HOURS = "08:00-18:00";
    try {
      const fin = readSessionToken(createSessionToken("f", "FINANCE", wib("09:15")))!;
      // readSessionToken menolak token yang sudah lewat waktu nyata, jadi cek exp lewat payload.
      expect(fin === null || fin.exp === Math.floor(wib("18:00") / 1000)).toBe(true);
      const payload = JSON.parse(Buffer.from(createSessionToken("f", "FINANCE", wib("09:15")).split(".")[0], "base64url").toString());
      expect(payload.exp).toBe(Math.floor(wib("18:00") / 1000));
      const owner = JSON.parse(Buffer.from(createSessionToken("o", "OWNER", wib("17:00")).split(".")[0], "base64url").toString());
      expect(owner.exp).toBe(Math.floor(wib("17:00") / 1000) + 24 * 3600);
    } finally {
      process.env.ACCESS_HOURS = prev;
    }
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const store = { subs: [] as Array<{ id: string; endpoint: string; p256dh: string; auth: string; userId: string; role: string; userAgent: string; failureCount: number }>, deleted: [] as string[] };
const sendNotification = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) } }));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    pushSubscription: {
      findMany: vi.fn(async ({ where }: { where: { userId?: string } }) => store.subs.filter((s) => !where.userId || s.userId === where.userId)),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => { store.deleted.push(where.id); return {}; }),
    },
  },
}));

const sub = (id: string) => ({ id, endpoint: `https://web.push.apple.com/${id}`, p256dh: "k", auth: "a", userId: "owner", role: "OWNER", userAgent: "Mozilla/5.0 (iPhone)", failureCount: 4 });

describe("pengiriman notifikasi push", () => {
  beforeEach(() => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    delete process.env.PUSH_ENABLED;
    store.subs = [sub("a")];
    store.deleted = [];
    sendNotification.mockReset();
  });

  it("alamat kontak VAPID localhost/kosong diganti alamat yang diterima Apple", async () => {
    const { validVapidSubject, DEFAULT_VAPID_SUBJECT } = await import("@/lib/push/config");
    expect(validVapidSubject(undefined)).toBe(DEFAULT_VAPID_SUBJECT);
    expect(validVapidSubject("mailto:admin@localhost")).toBe(DEFAULT_VAPID_SUBJECT);
    expect(validVapidSubject("https://localhost:3000")).toBe(DEFAULT_VAPID_SUBJECT);
    expect(validVapidSubject("mailto:owner@tokoku.id")).toBe("mailto:owner@tokoku.id");
    expect(validVapidSubject("https://slm.lrmint.xyz")).toBe("https://slm.lrmint.xyz");
  });

  it("403 dari Apple (salah pengaturan server) tidak menghapus perangkat dan alasannya dilaporkan", async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error("Received unexpected response code"), { statusCode: 403, body: '{"reason":"BadJwtToken"}' }));
    const { sendPushToUser } = await import("@/lib/push/send");
    const result = await sendPushToUser("owner", { title: "t", body: "b", url: "/" });
    expect(result).toMatchObject({ devices: 1, sent: 0, removed: 0 });
    expect(result.failures[0]).toMatchObject({ status: 403, device: "iPhone" });
    expect(result.failures[0].reason).toContain("BadJwtToken");
    expect(store.deleted).toEqual([]);
  });

  it("410 (aplikasi dihapus) menghapus perangkat; sukses dihitung", async () => {
    store.subs = [sub("gone"), sub("ok")];
    sendNotification.mockImplementation(async (s: { endpoint: string }) => {
      if (s.endpoint.endsWith("gone")) throw Object.assign(new Error("gone"), { statusCode: 410, body: "" });
    });
    const { sendPushToRoles } = await import("@/lib/push/send");
    const result = await sendPushToRoles(["OWNER"], { title: "t", body: "b", url: "/" });
    expect(result).toMatchObject({ devices: 2, sent: 1, removed: 1 });
    expect(store.deleted).toEqual(["gone"]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

const state = { clientActive: true, upserts: 0 };
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    integrationToken: { findMany: vi.fn(async () => []), update: vi.fn() },
    integrationClient: { upsert: vi.fn(async ({ where }: { where: { code: string } }) => { state.upserts += 1; return { id: "client-1", code: where.code, environment: "production", isActive: state.clientActive }; }) },
    integrationRateLimit: { upsert: vi.fn(async () => ({ requestCount: 1 })) },
  },
}));

const TOKEN = "slm_production_abcd1234_" + "x".repeat(43);
const req = (token: string) => new Request("http://localhost/api/integrations/mj/locations", { headers: { authorization: `Bearer ${token}` } });

describe("token MJ permanen dari .env (hash bcrypt)", () => {
  beforeEach(() => {
    vi.stubEnv("MJ_INTEGRATION_ENVIRONMENT", "production");
    vi.stubEnv("MJ_INTEGRATION_TOKEN_BCRYPT", `'${bcrypt.hashSync(TOKEN, 4)}'`);
    state.clientActive = true;
  });

  it("token yang cocok diterima tanpa masa berlaku", async () => {
    const { authenticateMjRequest } = await import("@/lib/integrations/mj/auth");
    await expect(authenticateMjRequest(req(TOKEN), "read")).resolves.toMatchObject({ clientCode: "mj-production", environment: "production", tokenId: "env:MJ_INTEGRATION_TOKEN_BCRYPT" });
  });

  it("token lain, token sandbox, dan client yang dinonaktifkan ditolak", async () => {
    const { authenticateMjRequest } = await import("@/lib/integrations/mj/auth");
    await expect(authenticateMjRequest(req(TOKEN.replace(/x$/, "y")), "read")).rejects.toMatchObject({ status: 401 });
    await expect(authenticateMjRequest(req(TOKEN.replace("production", "sandbox")), "read")).rejects.toMatchObject({ status: 401 });
    state.clientActive = false;
    await expect(authenticateMjRequest(req(TOKEN), "read")).rejects.toMatchObject({ status: 401 });
  });

  it("hash kosong atau terpotong (tanda $ hilang) tidak menerima token apa pun", async () => {
    const { authenticateMjRequest } = await import("@/lib/integrations/mj/auth");
    vi.stubEnv("MJ_INTEGRATION_TOKEN_BCRYPT", "");
    await expect(authenticateMjRequest(req(TOKEN), "read")).rejects.toMatchObject({ status: 401 });
    vi.stubEnv("MJ_INTEGRATION_TOKEN_BCRYPT", "2b12abc");
    await expect(authenticateMjRequest(req(TOKEN), "read")).rejects.toMatchObject({ status: 401 });
  });
});

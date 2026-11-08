import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  prisma: {
    inventoryProduct: { findFirst: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() }
  },
  authenticateMjRequest: vi.fn(),
  saveLocalImage: vi.fn()
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/integrations/mj/auth", () => ({ authenticateMjRequest: mocks.authenticateMjRequest }));
vi.mock("@/lib/opencloud/storage", () => ({ saveLocalImage: mocks.saveLocalImage }));

import { DELETE, POST } from "@/app/api/integrations/mj/products/[id]/photo/route";
import { MjIntegrationError } from "@/lib/integrations/mj/errors";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
function photoRequest(method = "POST") {
  const body = new FormData();
  body.append("file", new File([new Uint8Array([1, 2, 3])], "foto.jpg", { type: "image/jpeg" }));
  return new Request("https://slm.test/api/integrations/mj/products/AJMJ-24/photo", {
    method,
    headers: { authorization: "Bearer t", "x-mj-actor": "Aira" },
    body: method === "POST" ? body : undefined
  });
}

describe("foto barang dari MJ ke SLM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateMjRequest.mockResolvedValue({ clientId: "c1", clientCode: "mj", environment: "production", tokenId: "t1" });
    mocks.prisma.inventoryProduct.findFirst.mockResolvedValue({ id: "P1", sku: "AJMJ-24", photoUrl: null });
    mocks.saveLocalImage.mockResolvedValue({ success: true, data: { url: "/uploads/products/AJMJ-24-1.jpg" } });
  });

  it("menyimpan foto ke produk SLM (dicari lewat SKU) dan mencatat audit", async () => {
    const res = await POST(photoRequest(), params("AJMJ-24"));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ success: true, data: { photoUrl: "/uploads/products/AJMJ-24-1.jpg", sku: "AJMJ-24" } });
    expect(mocks.authenticateMjRequest).toHaveBeenCalledWith(expect.any(Request), "mutation");
    expect(mocks.saveLocalImage).toHaveBeenCalledWith(expect.any(File), "products", "AJMJ-24");
    expect(mocks.prisma.inventoryProduct.update).toHaveBeenCalledWith({ where: { id: "P1" }, data: { photoUrl: "/uploads/products/AJMJ-24-1.jpg" } });
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entityType: "product", entityId: "P1", userId: "integration:mj", userNameSnapshot: "Integration MJ (Aira)" })
    }));
  });

  it("menolak token tidak sah tanpa menyimpan apa pun", async () => {
    mocks.authenticateMjRequest.mockRejectedValue(new MjIntegrationError("AUTH_INVALID", "Bearer token tidak valid.", 401));
    const res = await POST(photoRequest(), params("AJMJ-24"));
    expect(res.status).toBe(401);
    expect(mocks.saveLocalImage).not.toHaveBeenCalled();
    expect(mocks.prisma.inventoryProduct.update).not.toHaveBeenCalled();
  });

  it("barang tidak ada di SLM -> 404", async () => {
    mocks.prisma.inventoryProduct.findFirst.mockResolvedValue(null);
    const res = await POST(photoRequest(), params("TIDAK-ADA"));
    expect(res.status).toBe(404);
    expect(mocks.saveLocalImage).not.toHaveBeenCalled();
  });

  it("format foto ditolak -> 400, produk tidak berubah", async () => {
    mocks.saveLocalImage.mockResolvedValue({ success: false, message: "Format foto harus JPG, PNG, atau WEBP." });
    const res = await POST(photoRequest(), params("AJMJ-24"));
    expect(res.status).toBe(400);
    expect(mocks.prisma.inventoryProduct.update).not.toHaveBeenCalled();
  });

  it("hapus foto dari MJ mengosongkan foto di SLM", async () => {
    mocks.prisma.inventoryProduct.findFirst.mockResolvedValue({ id: "P1", sku: "AJMJ-24", photoUrl: "/uploads/products/lama.jpg" });
    const res = await DELETE(photoRequest("DELETE"), params("AJMJ-24"));
    expect(res.status).toBe(200);
    expect(mocks.prisma.inventoryProduct.update).toHaveBeenCalledWith({ where: { id: "P1" }, data: { photoUrl: null } });
  });
});

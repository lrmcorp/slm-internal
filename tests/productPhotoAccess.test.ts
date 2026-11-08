import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  role: "ADMIN" as string,
  prisma: { inventoryProduct: { findUnique: vi.fn(), update: vi.fn() } },
  saveLocalImage: vi.fn()
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentRole: vi.fn(async () => mocks.role) }));
vi.mock("@/lib/db/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/opencloud/storage", () => ({ saveLocalImage: mocks.saveLocalImage }));

import { can, canEditProductPhoto } from "@/lib/auth/roles";
import { POST } from "@/app/api/inventory/products/[id]/photo/route";

function upload() {
  const body = new FormData();
  body.append("file", new File([new Uint8Array(3)], "f.jpg", { type: "image/jpeg" }));
  return new Request("https://slm.test/api/inventory/products/P1/photo", { method: "POST", body });
}

describe("akses foto barang SLM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.inventoryProduct.findUnique.mockResolvedValue({ id: "P1", sku: "AJMJ-24" });
    mocks.saveLocalImage.mockResolvedValue({ success: true, data: { url: "/uploads/products/a.jpg" } });
  });

  it("Admin (Sales) boleh ubah foto, tapi tetap tidak punya hak Master Barang", () => {
    expect(canEditProductPhoto("ADMIN")).toBe(true);
    expect(can("ADMIN", "inventory.master")).toBe(false);
    expect(canEditProductPhoto("OWNER")).toBe(true);
    expect(canEditProductPhoto("FINANCE")).toBe(false);
    expect(canEditProductPhoto("DELIVERY_DRIVER")).toBe(false);
  });

  it("API: Admin bisa unggah foto", async () => {
    mocks.role = "ADMIN";
    const res = await POST(upload(), { params: Promise.resolve({ id: "P1" }) });
    expect(res.status).toBe(201);
    expect(mocks.prisma.inventoryProduct.update).toHaveBeenCalledWith({ where: { id: "P1" }, data: { photoUrl: "/uploads/products/a.jpg" } });
  });

  it("API: Finance ditolak", async () => {
    mocks.role = "FINANCE";
    const res = await POST(upload(), { params: Promise.resolve({ id: "P1" }) });
    expect(res.status).toBe(403);
    expect(mocks.saveLocalImage).not.toHaveBeenCalled();
  });
});

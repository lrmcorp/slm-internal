/** Barang baru dari Input Penjualan menunggu persetujuan Owner (jalan bila INVENTORY_TEST_DATABASE_URL diset). */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit/store", () => ({ recordAudit: async () => undefined }));

const url = process.env.INVENTORY_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("persetujuan barang baru (postgres)", () => {
  let approval: typeof import("@/lib/inventory/productApproval");
  let service: typeof import("@/lib/inventory/service");
  let prisma: typeof import("@/lib/db/prisma").prisma;
  const stamp = Date.now();
  const sku = (name: string) => `APPR-${stamp}-${name}`;
  const saleId = `APPR-SALE-${stamp}`;
  const sales = { name: "Rina", role: "ADMIN" as const };
  const owner = { name: "Pemilik", role: "OWNER" as const };

  const newProduct = (name: string, sellingPrice = 12000) =>
    prisma.inventoryProduct.create({ data: { sku: sku(name), name: `Barang ${name}`, unit: "Lusin", costPrice: 5000, sellingPrice } });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ prisma } = await import("@/lib/db/prisma"));
    approval = await import("@/lib/inventory/productApproval");
    service = await import("@/lib/inventory/service");
    const tipe = await prisma.bookkeepingType.findFirst();
    await prisma.salesRecord.create({ data: {
      id: saleId, saleDate: new Date(), tipeId: tipe!.id, tipeCodeSnapshot: tipe!.code, tipeNameSnapshot: tipe!.name,
      customerName: "Toko Uji", paymentMethod: "Cash", total: 24000, approvalStatus: "approved", transactionNumber: `SLM-${stamp}`,
      createdByUserId: "test", createdByNameSnapshot: "Rina", createdByRoleSnapshot: "ADMIN", createdAt: new Date(),
      items: { create: [{ id: `${saleId}-1`, productRef: sku("a"), quantity: 2, unitPrice: 12000, sortOrder: 0 }] }
    } });
  });

  afterAll(async () => {
    await prisma.salesRecord.deleteMany({ where: { id: saleId } });
    await prisma.inventoryProduct.deleteMany({ where: { sku: { startsWith: `APPR-${stamp}-` } } });
  });

  const inMaster = async (code: string, includeInactive = false) =>
    (await service.listProducts({ keyword: code, includeInactive })).data.some((row) => row.sku === code);

  it("barang dari sales menunggu persetujuan: nonaktif, modal 0, tidak di Master Barang, tampil di daftar Owner", async () => {
    const product = await newProduct("a");
    expect(await approval.markRequestedFromSale(product.id, sales)).toBe("pending_approval");
    const row = await prisma.inventoryProduct.findUniqueOrThrow({ where: { id: product.id } });
    expect(row).toMatchObject({ approvalStatus: "pending_approval", isActive: false, requestedByName: "Rina" });
    expect(Number(row.costPrice)).toBe(0);
    expect(await inMaster(sku("a"))).toBe(false);
    expect(await inMaster(sku("a"), true)).toBe(false);

    const pending = (await approval.listPendingProducts()).find((item) => item.sku === sku("a"));
    expect(pending).toMatchObject({ name: "Barang a", sellingPrice: 12000, requestedByName: "Rina" });
    expect(pending?.sales).toEqual([{ id: saleId, number: `SLM-${stamp}`, customerName: "Toko Uji", quantity: 2, unitPrice: 12000 }]);
  });

  it("hanya Owner yang menyetujui; disetujui masuk Master Barang dengan harga jual pilihan Owner dan modal 0", async () => {
    const product = await prisma.inventoryProduct.findUniqueOrThrow({ where: { sku: sku("a") } });
    await expect(approval.decideProductApproval(product.id, { action: "approve" }, sales)).rejects.toThrow(/Owner/);
    await approval.decideProductApproval(product.id, { action: "approve", sellingPrice: 15000 }, owner);
    const row = await prisma.inventoryProduct.findUniqueOrThrow({ where: { id: product.id } });
    expect(row).toMatchObject({ approvalStatus: "approved", isActive: true, approvalDecidedBy: "Pemilik" });
    expect(Number(row.sellingPrice)).toBe(15000);
    expect(Number(row.costPrice)).toBe(0);
    expect(await inMaster(sku("a"))).toBe(true);
    await expect(approval.decideProductApproval(product.id, { action: "reject" }, owner)).rejects.toThrow(/sudah diputuskan/);
  });

  it("ditolak tetap di luar Master Barang; barang dari Owner sendiri langsung masuk", async () => {
    const rejected = await newProduct("b");
    await approval.markRequestedFromSale(rejected.id, sales);
    await approval.decideProductApproval(rejected.id, { action: "reject", reason: "salah ketik" }, owner);
    const row = await prisma.inventoryProduct.findUniqueOrThrow({ where: { id: rejected.id } });
    expect(row).toMatchObject({ approvalStatus: "rejected", isActive: false });
    expect(row.notes).toContain("salah ketik");
    expect(await inMaster(sku("b"), true)).toBe(false);
    expect((await approval.listPendingProducts()).some((item) => item.sku === sku("b"))).toBe(false);

    const byOwner = await newProduct("c");
    expect(await approval.markRequestedFromSale(byOwner.id, owner)).toBe("approved");
    expect(await inMaster(sku("c"))).toBe(true);
  });

  it("kode baru dari nota MJ menunggu persetujuan dengan harga AJ dari nota; kode yang sudah ada tidak diubah", async () => {
    const created = await approval.ensurePendingProductsForExternalSale([
      { sku: sku("mj1"), name: "Kuku MJ Baru", unit: "Pcs", unitPrice: 3000 },
      { sku: sku("MJ1"), name: "duplikat beda huruf", unitPrice: 9999 },
      { sku: sku("c"), name: "sudah ada", unitPrice: 1 }
    ], "MJ");
    expect(created.map((item) => item.sku)).toEqual([sku("mj1")]);
    const row = await prisma.inventoryProduct.findUniqueOrThrow({ where: { sku: sku("mj1") } });
    expect(row).toMatchObject({ name: "Kuku MJ Baru", unit: "Pcs", approvalStatus: "pending_approval", isActive: false, requestedByName: "MJ" });
    expect(Number(row.sellingPrice)).toBe(3000);
    expect(Number(row.costPrice)).toBe(0);
    expect(Number((await prisma.inventoryProduct.findUniqueOrThrow({ where: { sku: sku("c") } })).sellingPrice)).toBe(12000);
    expect(await approval.ensurePendingProductsForExternalSale([{ sku: sku("mj1"), name: "x", unitPrice: 1 }], "MJ")).toEqual([]);
  });
});

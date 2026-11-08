import { prisma } from "@/lib/db/prisma";
import { authenticateMjRequest, type MjIntegrationPrincipal } from "@/lib/integrations/mj/auth";
import { MjIntegrationError, mjErrorResponse } from "@/lib/integrations/mj/errors";
import { saveLocalImage } from "@/lib/opencloud/storage";

/**
 * Foto barang dari MJ. Foto disimpan di SLM (satu-satunya sumber), jadi foto yang diunggah dari MJ
 * langsung tampil di Master Barang SLM, dan foto dari SLM tampil di MJ lewat API produk.
 * {id} boleh ID barang SLM atau SKU.
 */
async function findProduct(idOrSku: string) {
  const key = decodeURIComponent(idOrSku).trim();
  const product = await prisma.inventoryProduct.findFirst({
    where: { OR: [{ id: key }, { sku: { equals: key, mode: "insensitive" } }] },
    select: { id: true, sku: true, photoUrl: true }
  });
  if (!product) throw new MjIntegrationError("VALIDATION_FAILED", `Barang ${key} tidak ditemukan di SLM.`, 404);
  return product;
}

async function audit(principal: MjIntegrationPrincipal, productId: string, before: string | null, after: string | null, actorName: string | null) {
  await prisma.auditLog.create({
    data: {
      id: crypto.randomUUID(),
      entityType: "product",
      entityId: productId,
      action: "update",
      beforeValue: { photoUrl: before },
      afterValue: { photoUrl: after },
      userId: `integration:${principal.clientCode}`,
      userNameSnapshot: `Integration ${principal.clientCode.toUpperCase()}${actorName ? ` (${actorName.slice(0, 80)})` : ""}`,
      userRoleSnapshot: "OWNER",
      reason: after ? "Foto barang diunggah dari MJ" : "Foto barang dihapus dari MJ"
    }
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authenticateMjRequest(request, "mutation");
    const product = await findProduct((await context.params).id);
    const file = (await request.formData().catch(() => null))?.get("file");
    if (!(file instanceof File)) throw new MjIntegrationError("VALIDATION_FAILED", "Pilih foto dulu.", 400);
    const saved = await saveLocalImage(file, "products", product.sku);
    if (!saved.success) throw new MjIntegrationError("VALIDATION_FAILED", saved.message || "Foto gagal disimpan.", 400);
    await prisma.inventoryProduct.update({ where: { id: product.id }, data: { photoUrl: saved.data.url } });
    await audit(principal, product.id, product.photoUrl, saved.data.url, request.headers.get("x-mj-actor"));
    return Response.json({ success: true, data: { productId: product.id, sku: product.sku, photoUrl: saved.data.url } }, { status: 201 });
  } catch (error) {
    return mjErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await authenticateMjRequest(request, "mutation");
    const product = await findProduct((await context.params).id);
    await prisma.inventoryProduct.update({ where: { id: product.id }, data: { photoUrl: null } });
    await audit(principal, product.id, product.photoUrl, null, request.headers.get("x-mj-actor"));
    return Response.json({ success: true, data: { productId: product.id, sku: product.sku, photoUrl: null } });
  } catch (error) {
    return mjErrorResponse(error);
  }
}

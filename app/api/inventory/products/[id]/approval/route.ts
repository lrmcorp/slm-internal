import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { decideProductApproval, ProductApprovalError } from "@/lib/inventory/productApproval";

const bodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  sellingPrice: z.number().finite().min(0).optional(),
  reason: z.string().max(300).optional()
});

/** Owner menyetujui/menolak barang baru dari Input Penjualan. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (user.id === "unauthenticated") return NextResponse.json({ success: false, message: "Silakan login." }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, message: "Data persetujuan tidak valid." }, { status: 400 });
  const { id } = await params;
  try {
    const product = await decideProductApproval(decodeURIComponent(id), parsed.data, user);
    return NextResponse.json({ success: true, data: { id: product.id, sku: product.sku, approvalStatus: product.approvalStatus } });
  } catch (error) {
    if (error instanceof ProductApprovalError) return NextResponse.json({ success: false, message: error.message }, { status: error.status });
    console.error("[product-approval]", error);
    return NextResponse.json({ success: false, message: "Persetujuan barang gagal disimpan." }, { status: 500 });
  }
}

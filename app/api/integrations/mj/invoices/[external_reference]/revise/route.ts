import { authenticateMjRequest } from "@/lib/integrations/mj/auth";
import { MjIntegrationError, mjErrorResponse } from "@/lib/integrations/mj/errors";
import { reviseMjInvoice } from "@/lib/integrations/mj/service";
import { mjInvoiceSchema } from "@/lib/integrations/mj/validation";

/** Revisi invoice MJ setelah transaksinya diedit di MJ (record_only): barang, total, jurnal, HPP, dan DO ikut berubah. */
export async function POST(request: Request, { params }: { params: Promise<{ external_reference: string }> }) {
  try {
    await authenticateMjRequest(request, "mutation");
    const parsed = mjInvoiceSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new MjIntegrationError("VALIDATION_FAILED", "Payload revisi invoice tidak valid.", 400, parsed.error.flatten());
    const { external_reference } = await params;
    return Response.json({ success: true, data: await reviseMjInvoice(decodeURIComponent(external_reference), parsed.data) });
  } catch (error) { return mjErrorResponse(error); }
}

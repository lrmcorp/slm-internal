import { authenticateMjRequest } from "@/lib/integrations/mj/auth";
import { MjIntegrationError, mjErrorResponse } from "@/lib/integrations/mj/errors";
import { listMjCancellations } from "@/lib/integrations/mj/service";

export const dynamic = "force-dynamic";

/** Transaksi MJ yang dibatalkan sejak `since` (ISO). MJ memakainya untuk ikut membatalkan yang dibatalkan dari SLM. */
export async function GET(request: Request) {
  try {
    await authenticateMjRequest(request, "read");
    const raw = new URL(request.url).searchParams.get("since");
    const since = raw ? new Date(raw) : new Date(Date.now() - 7 * 86_400_000);
    if (Number.isNaN(since.getTime())) throw new MjIntegrationError("VALIDATION_FAILED", "Parameter since harus tanggal ISO.", 400);
    return Response.json({ success: true, data: await listMjCancellations(since) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mjErrorResponse(error);
  }
}

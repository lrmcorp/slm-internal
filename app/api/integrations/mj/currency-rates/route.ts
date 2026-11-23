import { authenticateMjRequest } from "@/lib/integrations/mj/auth";
import { mjErrorResponse } from "@/lib/integrations/mj/errors";
import { listManualRates } from "@/lib/currency/displayRates";

/** Kurs tampilan (Rupiah per 1 unit) untuk MJ, diteruskan ke Katalog (dipakai menurut lokasi pengunjung). Mata uang tanpa kurs tidak dikirim. */
export async function GET(request: Request) {
  try {
    await authenticateMjRequest(request, "read");
    const rates = (await listManualRates()).filter((item) => item.rate != null);
    return Response.json({
      success: true,
      data: rates.map((item) => ({ currency: item.currency, rate_idr: item.rate, updated_at: item.updatedAt ?? null }))
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mjErrorResponse(error);
  }
}

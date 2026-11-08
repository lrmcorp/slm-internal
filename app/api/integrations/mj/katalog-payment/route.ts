import { authenticateMjRequest } from "@/lib/integrations/mj/auth";
import { mjErrorResponse } from "@/lib/integrations/mj/errors";
import { getKatalogPaymentAccount } from "@/lib/settings/katalogPayment";

/** Rekening tujuan transfer Katalog Online untuk MJ (diteruskan ke katalog). data null = belum diatur. */
export async function GET(request: Request) {
  try {
    await authenticateMjRequest(request, "read");
    const account = await getKatalogPaymentAccount();
    return Response.json({
      success: true,
      data: account ? { rekening_id: account.rekeningId, bank_name: account.bankName, account_number: account.accountNumber, account_holder: account.accountHolder } : null
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mjErrorResponse(error);
  }
}

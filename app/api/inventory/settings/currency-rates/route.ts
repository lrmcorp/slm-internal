import { inventoryRoute, parseBody, auditInventory } from "@/lib/inventory/http";
import { listManualRates, setManualRate } from "@/lib/currency/displayRates";
import { displayRateSchema } from "@/lib/inventory/validation";

/** Kurs SGD, MYR, dan THB untuk tampilan harga di Master Barang dan Katalog. */
export const GET = inventoryRoute("inventory.master", async () => listManualRates());

/** Ganti satu kurs tampilan. Harga yang tersimpan (Rupiah) tidak berubah. */
export const PUT = inventoryRoute("inventory.master", async (request, ctx) => {
  const { currency, rate } = await parseBody(request, displayRateSchema);
  const result = await setManualRate(currency, rate, ctx.actor);
  await auditInventory(ctx, "currency-rate", `Kurs ${currency} ${result.previousRate ?? "-"} → ${rate}`, result);
  return result;
});

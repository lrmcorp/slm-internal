import "server-only";
import { prisma } from "@/lib/db/prisma";
import { InventoryError } from "@/lib/inventory/errors";
import { getRmbRate } from "@/lib/inventory/pricing";
import { MANUAL_RATE_CURRENCIES, type DisplayRates, type ManualRateCurrency } from "./displayCurrencies";

const keyFor = (currency: ManualRateCurrency) => `currency.display_rate.${currency}`;

export type ManualRateInfo = { currency: ManualRateCurrency; rate: number | null; updatedAt?: string; updatedBy?: string | null };

/** Kurs SGD, MYR, dan THB yang diatur manual (Rupiah per 1 unit). */
export async function listManualRates(): Promise<ManualRateInfo[]> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: MANUAL_RATE_CURRENCIES.map(keyFor) } } });
  return MANUAL_RATE_CURRENCIES.map((currency) => {
    const row = rows.find((item) => item.key === keyFor(currency));
    const rate = row ? Number(row.value) : NaN;
    return Number.isFinite(rate) && rate > 0
      ? { currency, rate, updatedAt: row!.updatedAt.toISOString(), updatedBy: row!.updatedByNameSnapshot }
      : { currency, rate: null };
  });
}

/** Semua kurs tampilan: RMB dari kurs modal, sisanya dari kurs manual. */
export async function getDisplayRates(): Promise<DisplayRates> {
  const [rmb, manual] = await Promise.all([getRmbRate(), listManualRates()]);
  const rateOf = (currency: ManualRateCurrency) => manual.find((item) => item.currency === currency)?.rate ?? null;
  return { RMB: rmb.rate, SGD: rateOf("SGD"), MYR: rateOf("MYR"), THB: rateOf("THB") };
}

/** Simpan kurs tampilan. Tidak mengubah harga modal, harga jual, atau nilai stok. */
export async function setManualRate(currency: ManualRateCurrency, rate: number, actor?: { id?: string; name?: string }) {
  if (!Number.isFinite(rate) || rate <= 0) throw new InventoryError("VALIDATION", "Kurs harus lebih dari 0.");
  const previous = (await listManualRates()).find((item) => item.currency === currency)?.rate ?? null;
  await prisma.appSetting.upsert({
    where: { key: keyFor(currency) },
    create: { key: keyFor(currency), value: String(rate), description: `Kurs ${currency}→IDR untuk tampilan harga (Master Barang dan Katalog)`, updatedByUserId: actor?.id, updatedByNameSnapshot: actor?.name },
    update: { value: String(rate), updatedByUserId: actor?.id, updatedByNameSnapshot: actor?.name }
  });
  return { currency, rate, previousRate: previous };
}

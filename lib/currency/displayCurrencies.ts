/**
 * Mata uang tampilan untuk Master Barang dan Katalog. Data harga tetap disimpan dalam Rupiah;
 * kurs di sini hanya dipakai untuk menampilkan harga ke mata uang lain.
 */
export const DISPLAY_CURRENCIES = [
  { code: "IDR", label: "Rupiah", country: "Indonesia", symbol: "Rp", decimals: 0 },
  { code: "RMB", label: "Renminbi", country: "Tiongkok", symbol: "¥", decimals: 2 },
  { code: "SGD", label: "Dolar Singapura", country: "Singapura", symbol: "S$", decimals: 2 },
  { code: "MYR", label: "Ringgit Malaysia", country: "Malaysia", symbol: "RM", decimals: 2 },
  { code: "THB", label: "Baht Thailand", country: "Thailand", symbol: "฿", decimals: 2 }
] as const;

export type DisplayCurrencyCode = (typeof DISPLAY_CURRENCIES)[number]["code"];
/** Kurs yang diatur manual di halaman Master Barang (RMB punya pengaturan sendiri karena menghitung modal). */
export const MANUAL_RATE_CURRENCIES = ["SGD", "MYR", "THB"] as const;
export type ManualRateCurrency = (typeof MANUAL_RATE_CURRENCIES)[number];
/** Rupiah per 1 unit mata uang asing; null = kurs belum diatur. */
export type DisplayRates = Record<Exclude<DisplayCurrencyCode, "IDR">, number | null>;

export function displayCurrency(code: string) {
  return DISPLAY_CURRENCIES.find((item) => item.code === code) ?? DISPLAY_CURRENCIES[0];
}

/** Nilai Rupiah diubah ke mata uang tampilan. null bila kursnya belum diatur. */
export function convertFromIdr(amountIdr: number, code: DisplayCurrencyCode, rates: Partial<DisplayRates>): number | null {
  if (code === "IDR") return amountIdr;
  const rate = rates[code];
  if (!rate || !(rate > 0)) return null;
  const factor = 10 ** displayCurrency(code).decimals;
  return Math.round((amountIdr / rate) * factor) / factor;
}

export function formatDisplayMoney(amount: number, code: DisplayCurrencyCode) {
  const currency = displayCurrency(code);
  const text = amount.toLocaleString("id-ID", { minimumFractionDigits: currency.decimals, maximumFractionDigits: currency.decimals });
  return `${currency.symbol} ${text}`;
}

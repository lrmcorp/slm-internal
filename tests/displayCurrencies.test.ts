import { describe, expect, it } from "vitest";
import { convertFromIdr, formatDisplayMoney } from "@/lib/currency/displayCurrencies";
import { parseRateInput } from "@/components/inventory/CurrencyRatesForm";
import { displayRateSchema } from "@/lib/inventory/validation";

const rates = { RMB: 2750, SGD: 12150, MYR: 3580, THB: 468.5 };

describe("Kurs tampilan Master Barang", () => {
  it("converts Rupiah with the saved rate and leaves Rupiah untouched", () => {
    expect(convertFromIdr(112000, "IDR", rates)).toBe(112000);
    expect(convertFromIdr(112000, "SGD", rates)).toBe(9.22);
    expect(convertFromIdr(112000, "MYR", rates)).toBe(31.28);
    expect(convertFromIdr(112000, "THB", rates)).toBe(239.06);
    expect(convertFromIdr(112000, "RMB", rates)).toBe(40.73);
  });

  it("returns null when the rate is not set, so the table falls back to Rupiah", () => {
    expect(convertFromIdr(112000, "SGD", { ...rates, SGD: null })).toBeNull();
    expect(convertFromIdr(112000, "MYR", {})).toBeNull();
  });

  it("formats with the currency symbol and two decimals", () => {
    expect(formatDisplayMoney(9.22, "SGD")).toBe("S$ 9,22");
    expect(formatDisplayMoney(1234.5, "MYR")).toBe("RM 1.234,50");
  });

  it("reads rates typed the Indonesian way", () => {
    expect(parseRateInput("12.150")).toBe(12150);
    expect(parseRateInput("468,5")).toBe(468.5);
    expect(parseRateInput("3580")).toBe(3580);
    expect(Number.isNaN(parseRateInput(""))).toBe(true);
  });

  it("accepts only SGD, MYR and THB with a positive rate", () => {
    expect(displayRateSchema.safeParse({ currency: "SGD", rate: 12150 }).success).toBe(true);
    expect(displayRateSchema.safeParse({ currency: "RMB", rate: 2750 }).success).toBe(false);
    expect(displayRateSchema.safeParse({ currency: "MYR", rate: 0 }).success).toBe(false);
    // null menghapus kurs, sehingga negaranya hilang dari pilihan.
    expect(displayRateSchema.safeParse({ currency: "THB", rate: null }).data).toEqual({ currency: "THB", rate: null });
  });
});

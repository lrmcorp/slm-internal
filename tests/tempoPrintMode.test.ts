import { describe, expect, it } from "vitest";
import { tempoPrintsAsInvoice, tempoPrintsAsInvoiceForRequest } from "@/lib/print/tempoPrintMode";

describe("Tempo dicetak sebagai invoice khusus ANKJY", () => {
  it("otomatis untuk domain ankjy.net dan ankjy.lrmslm.com, tidak untuk SLM/MJ", () => {
    expect(tempoPrintsAsInvoice({}, "ankjy.net")).toBe(true);
    expect(tempoPrintsAsInvoice({}, "WWW.ankjy.net:443")).toBe(true);
    expect(tempoPrintsAsInvoice({}, "ankjy.lrmslm.com")).toBe(true);
    expect(tempoPrintsAsInvoice({}, "slm.lrmslm.com")).toBe(false);
    expect(tempoPrintsAsInvoice({}, "mj.lrmslm.com")).toBe(false);
    expect(tempoPrintsAsInvoice({})).toBe(false);
  });

  it("PRINT_TEMPO_AS_INVOICE memaksa nyala/mati; TEMPO_INVOICE_HOSTS mengganti daftar domain", () => {
    expect(tempoPrintsAsInvoice({ PRINT_TEMPO_AS_INVOICE: "true" }, "slm.lrmslm.com")).toBe(true);
    expect(tempoPrintsAsInvoice({ PRINT_TEMPO_AS_INVOICE: "false" }, "ankjy.net")).toBe(false);
    expect(tempoPrintsAsInvoice({ TEMPO_INVOICE_HOSTS: "toko.test" }, "toko.test")).toBe(true);
    expect(tempoPrintsAsInvoice({ TEMPO_INVOICE_HOSTS: "toko.test" }, "ankjy.net")).toBe(false);
  });

  it("route membaca domain dari header Host", () => {
    const req = (host: string) => new Request("http://localhost/api/print/sales/x", { headers: { host } });
    expect(tempoPrintsAsInvoiceForRequest(req("ankjy.net"))).toBe(true);
    expect(tempoPrintsAsInvoiceForRequest(req("slm.lrmslm.com"))).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const posted: Array<{ sourceType: string; lines: Array<{ accountId: string; debit: number; credit: number }> }> = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({
  prisma: { rekeningAccount: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, name: where.id.toUpperCase(), isActive: true })) } }
}));
vi.mock("@/lib/accounting/accountStore", () => ({
  ensureStandardAccounts: vi.fn(async () => undefined),
  getAccountByCode: vi.fn(async (code: string) => ({ id: `acc-${code}`, code }))
}));
vi.mock("@/lib/accounting/rekeningLedger", () => ({
  GENERAL_CASH_CODE: "1-1001",
  cashAccountForRekening: vi.fn(async (id: string) => ({ id: `acc-rek-${id}` }))
}));
vi.mock("@/lib/accounting/journalStore", () => ({
  postJournalEntry: vi.fn(async (input: (typeof posted)[number]) => { posted.push(input); return { id: "j1", journalNumber: "JV-1" }; }),
  reverseJournalEntry: vi.fn()
}));

const actor = { id: "u1", name: "Fin", role: "FINANCE" as const };
const sides = () => posted[0].lines.map((l) => `${l.accountId}:${l.debit}/${l.credit}`);

describe("Mutasi Kas & Bank", () => {
  beforeEach(() => { posted.length = 0; });

  it("setor tunai: bank bertambah, kas berkurang, jurnal seimbang", async () => {
    const { createCashBankMutation, cashBankSchema } = await import("@/lib/accounting/cashBank");
    await createCashBankMutation(cashBankSchema.parse({ type: "SETOR_TUNAI", date: "2026-11-10", fromRekeningId: "kas", toRekeningId: "bca", amount: 5_000_000 }), actor);
    expect(posted[0].sourceType).toBe("CASH_BANK");
    expect(sides()).toEqual(["acc-rek-bca:5000000/0", "acc-rek-kas:0/5000000"]);
  });

  it("biaya admin: beban administrasi bank vs rekening", async () => {
    const { createCashBankMutation, cashBankSchema } = await import("@/lib/accounting/cashBank");
    await createCashBankMutation(cashBankSchema.parse({ type: "BIAYA_ADMIN", date: "2026-11-10", fromRekeningId: "bca", amount: 15000 }), actor);
    expect(sides()).toEqual(["acc-6-1009:15000/0", "acc-rek-bca:0/15000"]);
  });

  it("bunga dan modal masuk menambah rekening; prive mengurangi", async () => {
    const { createCashBankMutation, cashBankSchema } = await import("@/lib/accounting/cashBank");
    await createCashBankMutation(cashBankSchema.parse({ type: "BUNGA", date: "2026-11-10", toRekeningId: "bca", amount: 1200 }), actor);
    expect(sides()).toEqual(["acc-rek-bca:1200/0", "acc-4-2001:0/1200"]);
    posted.length = 0;
    await createCashBankMutation(cashBankSchema.parse({ type: "MODAL_MASUK", date: "2026-11-10", toRekeningId: "bca", amount: 100 }), actor);
    expect(sides()).toEqual(["acc-rek-bca:100/0", "acc-3-1001:0/100"]);
    posted.length = 0;
    await createCashBankMutation(cashBankSchema.parse({ type: "PRIVE", date: "2026-11-10", fromRekeningId: "kas", amount: 300 }), actor);
    expect(sides()).toEqual(["acc-3-1003:300/0", "acc-rek-kas:0/300"]);
  });

  it("menolak rekening asal = tujuan, nominal nol, dan rekening yang belum dipilih", async () => {
    const { cashBankSchema } = await import("@/lib/accounting/cashBank");
    expect(cashBankSchema.safeParse({ type: "TRANSFER", date: "2026-11-10", fromRekeningId: "bca", toRekeningId: "bca", amount: 1 }).success).toBe(false);
    expect(cashBankSchema.safeParse({ type: "SETOR_TUNAI", date: "2026-11-10", fromRekeningId: "kas", toRekeningId: "bca", amount: 0 }).success).toBe(false);
    expect(cashBankSchema.safeParse({ type: "BIAYA_ADMIN", date: "2026-11-10", amount: 1 }).success).toBe(false);
  });

  it("hanya Owner, Supervisor, dan Finance yang boleh", async () => {
    const { can, ROLES } = await import("@/lib/auth/roles");
    const allowed = ROLES.filter((r) => can(r, "cashbank.manage"));
    expect(allowed.sort()).toEqual(["FINANCE", "OWNER", "SUPERVISOR"]);
  });
});

import "server-only";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { recordAudit } from "@/lib/audit/store";

/** Rekening tujuan transfer pesanan Katalog Online (satu rekening). Disimpan di AppSetting sebagai JSON. */
export const KATALOG_PAYMENT_KEY = "katalog_payment_account";

export type KatalogPaymentAccount = { rekeningId: string; rekeningName: string; bankName: string | null; accountNumber: string; accountHolder: string };

type Stored = { rekeningId?: string; accountHolder?: string };

async function readStored(): Promise<Stored> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: KATALOG_PAYMENT_KEY } });
    return row?.value ? (JSON.parse(row.value) as Stored) : {};
  } catch {
    return {};
  }
}

/** Rekening katalog yang aktif dan lengkap; null bila belum diatur atau rekeningnya dinonaktifkan. */
export async function getKatalogPaymentAccount(): Promise<KatalogPaymentAccount | null> {
  const stored = await readStored();
  if (!stored.rekeningId || !stored.accountHolder) return null;
  const rekening = await prisma.rekeningAccount.findFirst({ where: { id: stored.rekeningId, isActive: true } });
  if (!rekening?.accountNumber) return null;
  return { rekeningId: rekening.id, rekeningName: rekening.name, bankName: rekening.bankName, accountNumber: rekening.accountNumber, accountHolder: stored.accountHolder };
}

export async function getKatalogPaymentSetting() {
  const [stored, options] = await Promise.all([
    readStored(),
    prisma.rekeningAccount.findMany({ where: { isActive: true, accountNumber: { not: null } }, orderBy: { name: "asc" }, select: { id: true, name: true, bankName: true, accountNumber: true } })
  ]);
  return { rekeningId: stored.rekeningId ?? "", accountHolder: stored.accountHolder ?? "", options };
}

export async function updateKatalogPaymentSetting(input: { rekeningId: string; accountHolder: string }) {
  const rekeningId = input.rekeningId.trim();
  const accountHolder = input.accountHolder.trim().replace(/\s+/g, " ");
  if (rekeningId) {
    const rekening = await prisma.rekeningAccount.findFirst({ where: { id: rekeningId, isActive: true } });
    if (!rekening?.accountNumber) throw new Error("Pilih rekening aktif yang punya nomor rekening.");
    if (accountHolder.length < 2 || accountHolder.length > 80) throw new Error("Isi nama pemilik rekening (2 sampai 80 huruf).");
  }
  const user = await getCurrentUser();
  const before = await readStored();
  const value = JSON.stringify(rekeningId ? { rekeningId, accountHolder } : {});
  await prisma.appSetting.upsert({
    where: { key: KATALOG_PAYMENT_KEY },
    create: { key: KATALOG_PAYMENT_KEY, value, description: "Rekening tujuan transfer Katalog Online.", updatedByUserId: user.id, updatedByNameSnapshot: user.name },
    update: { value, updatedByUserId: user.id, updatedByNameSnapshot: user.name }
  });
  await recordAudit({ entityType: "app_setting", entityId: KATALOG_PAYMENT_KEY, action: "update", beforeValue: before, afterValue: JSON.parse(value), reason: "Update rekening Katalog Online" });
  return getKatalogPaymentSetting();
}

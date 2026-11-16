import "server-only";
import { prisma } from "@/lib/db/prisma";

/**
 * Label yang sama sering tertangkap berulang kali (paket masih di meja, atau server CCTV mengirim ulang).
 * Dalam jendela ini kiriman berikutnya untuk transaksi dan jenis event yang sama memperbarui catatan lama,
 * bukan menambah baris, supaya angka Deteksi menghitung paket, bukan jumlah kiriman.
 */
export const CCTV_REPEAT_WINDOW_MS = 12 * 60 * 60 * 1000;

export async function findRepeatDetection(input: { eventType: string; salesRecordId?: string | null; invoiceNumber?: string | null; now?: Date }) {
  const since = new Date((input.now ?? new Date()).getTime() - CCTV_REPEAT_WINDOW_MS);
  const key = input.salesRecordId ? { salesRecordId: input.salesRecordId } : input.invoiceNumber ? { invoiceNumber: input.invoiceNumber } : null;
  if (!key || typeof prisma.cctvDetectionLog?.findFirst !== "function") return null;
  return prisma.cctvDetectionLog.findFirst({
    where: { eventType: input.eventType, ...key, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { id: true, evidenceUrl: true, screenshotPhotoUrl: true, packingCompletedAt: true, cctvLabelId: true }
  });
}

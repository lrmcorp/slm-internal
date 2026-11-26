import "server-only";
import { prisma } from "@/lib/db/prisma";

/**
 * Laporan DO yang belum terproses (status bukan "selesai"), dikirim ke Owner pukul 12.30 dan 15.00 WIB.
 * Nota draft, dibatalkan, ditolak, dan transaksi uji tidak dihitung.
 */
export type BacklogRow = { doNumber: string; customerName: string; packingStatus: string; shippingStatus: string; createdAt: Date };
export type DeliveryOrderBacklog = { total: number; notPacked: BacklogRow[]; notShipped: BacklogRow[]; partial: BacklogRow[]; oldest: BacklogRow | null };

export async function deliveryOrderBacklog(): Promise<DeliveryOrderBacklog> {
  const rows = await prisma.deliveryOrder.findMany({
    where: {
      status: { not: "selesai" },
      salesRecord: { approvalStatus: { notIn: ["draft", "cancelled", "rejected"] }, isTestTransaction: false }
    },
    orderBy: { createdAt: "asc" },
    select: { doNumber: true, packingStatus: true, shippingStatus: true, createdAt: true, salesRecord: { select: { customerName: true } } }
  });
  const list: BacklogRow[] = rows.map((row) => ({
    doNumber: row.doNumber, customerName: row.salesRecord.customerName,
    packingStatus: row.packingStatus, shippingStatus: row.shippingStatus, createdAt: row.createdAt
  }));
  return {
    total: list.length,
    notPacked: list.filter((row) => row.packingStatus !== "sudah"),
    notShipped: list.filter((row) => row.packingStatus === "sudah" && row.shippingStatus !== "sudah"),
    // Sudah dipacking dan dikirim tetapi barangnya belum lengkap (status selesai_setengah).
    partial: list.filter((row) => row.packingStatus === "sudah" && row.shippingStatus === "sudah"),
    oldest: list[0] ?? null
  };
}

function age(from: Date, now: Date): string {
  const hours = Math.floor((now.getTime() - from.getTime()) / 3_600_000);
  if (hours < 1) return "baru saja";
  if (hours < 24) return `${hours} jam`;
  return `${Math.floor(hours / 24)} hari`;
}

const names = (rows: BacklogRow[]) =>
  rows.slice(0, 3).map((row) => `${row.doNumber} (${row.customerName})`).join(", ") + (rows.length > 3 ? `, +${rows.length - 3} lagi` : "");

/** Judul dan isi notifikasi, mis. "DO belum terproses · 12.30" / "5 DO: 3 belum dipacking ...". */
export function backlogMessage(report: DeliveryOrderBacklog, slot: string, now = new Date()) {
  if (!report.total) return { title: `DO ${slot}: semua sudah terproses`, body: "Tidak ada Delivery Order yang menunggu packing atau pengiriman." };
  const parts: string[] = [];
  if (report.notPacked.length) parts.push(`${report.notPacked.length} belum dipacking: ${names(report.notPacked)}`);
  if (report.notShipped.length) parts.push(`${report.notShipped.length} belum dikirim: ${names(report.notShipped)}`);
  if (report.partial.length) parts.push(`${report.partial.length} baru terkirim sebagian: ${names(report.partial)}`);
  const oldest = report.oldest ? `. Terlama ${report.oldest.doNumber}, ${age(report.oldest.createdAt, now)}` : "";
  return { title: `${report.total} DO belum terproses · ${slot}`, body: `${parts.join(". ")}${oldest}.` };
}

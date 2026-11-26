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

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} dan ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, dan ${names[names.length - 1]}`;
}

/**
 * Kalimat untuk speaker CCTV, mis. "Perhatian. Ada 3 pesanan yang belum diproses, atas nama Bu Ani,
 * Toko B, dan Pak Budi. Mohon segera diproses. Terima kasih." Satu nama disebut sekali walau pesanannya
 * lebih dari satu; lebih dari 5 nama disingkat "dan N lainnya". Null bila tidak ada yang perlu diumumkan.
 */
export function announcementText(report: DeliveryOrderBacklog, maxNames = 5): string | null {
  if (!report.total) return null;
  const all = [...report.notPacked, ...report.notShipped, ...report.partial].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const names = Array.from(new Set(all.map((row) => row.customerName.trim()).filter(Boolean)));
  const shown = names.slice(0, maxNames);
  const rest = names.length - shown.length;
  const who = rest > 0 ? `${shown.join(", ")}, dan ${rest} lainnya` : joinNames(shown);
  return `Perhatian. Ada ${report.total} pesanan yang belum diproses${who ? `, atas nama ${who}` : ""}. Mohon segera diproses. Terima kasih.`;
}

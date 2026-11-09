import "server-only";
import webpush from "web-push";
import { prisma } from "@/lib/db/prisma";
import { pushConfig } from "./config";

export type PushPayload = { title: string; body: string; url: string; tag?: string };

/** Langganan yang ditolak layanan push sebanyak ini dianggap mati dan dihapus. */
const MAX_FAILURES = 5;

/**
 * Kirim ke semua perangkat milik role tertentu. Tidak pernah melempar error: notifikasi tidak boleh
 * menggagalkan penjualan atau pergerakan stok yang memicunya.
 */
export async function sendPushToRoles(roles: readonly string[], payload: PushPayload): Promise<{ sent: number; removed: number }> {
  const config = pushConfig();
  if (!config.enabled || roles.length === 0) return { sent: 0, removed: 0 };
  try {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    const subscriptions = await prisma.pushSubscription.findMany({ where: { role: { in: Array.from(roles) } } });
    let sent = 0;
    let removed = 0;
    await Promise.all(subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 6, urgency: "high" });
        sent += 1;
        await prisma.pushSubscription.update({ where: { id: sub.id }, data: { lastSentAt: new Date(), failureCount: 0 } }).catch(() => undefined);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // 404/410: aplikasi dihapus atau izin notifikasi dicabut.
        if (status === 404 || status === 410 || sub.failureCount + 1 >= MAX_FAILURES) {
          removed += 1;
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        } else {
          await prisma.pushSubscription.update({ where: { id: sub.id }, data: { failureCount: { increment: 1 } } }).catch(() => undefined);
        }
      }
    }));
    return { sent, removed };
  } catch (error) {
    console.error("[push] gagal mengirim notifikasi:", error instanceof Error ? error.message : error);
    return { sent: 0, removed: 0 };
  }
}

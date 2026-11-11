import "server-only";
import webpush from "web-push";
import { prisma } from "@/lib/db/prisma";
import { pushConfig } from "./config";
import type { Role } from "@/lib/auth/roles";

export type PushPayload = { title: string; body: string; url: string; tag?: string };
export type PushFailure = { status?: number; reason: string; device: string };
export type PushResult = { devices: number; sent: number; removed: number; failures: PushFailure[] };

function deviceLabel(userAgent?: string | null) {
  if (!userAgent) return "Perangkat";
  if (/iPhone/i.test(userAgent)) return "iPhone";
  if (/iPad/i.test(userAgent)) return "iPad";
  if (/Android/i.test(userAgent)) return "Android";
  if (/Mac OS X/i.test(userAgent)) return "Mac";
  if (/Windows/i.test(userAgent)) return "Windows";
  return "Perangkat";
}

/** Langganan yang ditolak layanan push sebanyak ini dianggap mati dan dihapus. */
const MAX_FAILURES = 5;

/**
 * Kirim ke langganan yang cocok. Tidak pernah melempar error: notifikasi tidak boleh menggagalkan
 * penjualan atau pergerakan stok yang memicunya. Alasan gagal dicatat di log server.
 */
async function sendToSubscriptions(where: { role?: { in: string[] }; userId?: string | { in: string[] } }, payload: PushPayload): Promise<PushResult> {
  const config = pushConfig();
  const empty: PushResult = { devices: 0, sent: 0, removed: 0, failures: [] };
  if (!config.enabled) return empty;
  try {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    const subscriptions = await prisma.pushSubscription.findMany({ where });
    const result: PushResult = { ...empty, devices: subscriptions.length };
    await Promise.all(subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 6, urgency: "high" });
        result.sent += 1;
        await prisma.pushSubscription.update({ where: { id: sub.id }, data: { lastSentAt: new Date(), failureCount: 0 } }).catch(() => undefined);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        const body = String((error as { body?: unknown }).body ?? (error instanceof Error ? error.message : error)).slice(0, 200);
        const host = (() => { try { return new URL(sub.endpoint).host; } catch { return "?"; } })();
        console.error(`[push] gagal ke ${host} (${deviceLabel(sub.userAgent)}, user ${sub.userId}): ${status ?? "-"} ${body}`);
        result.failures.push({ status, reason: body, device: deviceLabel(sub.userAgent) });
        if (status === 404 || status === 410) {
          // Aplikasi dihapus atau izin notifikasi dicabut di perangkat.
          result.removed += 1;
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        } else if (status === 400 || status === 401 || status === 403) {
          // Kesalahan pengaturan server (kunci/alamat kontak VAPID), bukan perangkat: langganan tidak dihapus.
        } else if (sub.failureCount + 1 >= MAX_FAILURES) {
          result.removed += 1;
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        } else {
          await prisma.pushSubscription.update({ where: { id: sub.id }, data: { failureCount: { increment: 1 } } }).catch(() => undefined);
        }
      }
    }));
    return result;
  } catch (error) {
    console.error("[push] gagal mengirim notifikasi:", error instanceof Error ? error.message : error);
    return empty;
  }
}

/** Kirim ke semua perangkat user yang memegang salah satu role ini (role utama atau role tambahan). */
export async function sendPushToRoles(roles: readonly string[], payload: PushPayload): Promise<PushResult> {
  if (roles.length === 0) return { devices: 0, sent: 0, removed: 0, failures: [] };
  const list = Array.from(roles) as Role[];
  if (typeof prisma.user?.findMany !== "function") return sendToSubscriptions({ role: { in: list } }, payload);
  const users = await prisma.user.findMany({
    where: { isActive: true, OR: [{ role: { in: list } }, { extraRoles: { hasSome: list } }] },
    select: { externalId: true },
  }).catch(() => null);
  if (!users) return sendToSubscriptions({ role: { in: list } }, payload);
  return sendToSubscriptions({ userId: { in: users.map((u) => u.externalId) } }, payload);
}

/** Kirim ke semua perangkat milik satu user (dipakai tombol uji di Profil). */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<PushResult> {
  return sendToSubscriptions({ userId }, payload);
}

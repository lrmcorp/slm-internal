/**
 * Notifikasi push (Web Push). Aktif bila kunci VAPID diisi di env server per instance:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mis. mailto:admin@domain)
 * Kunci dibuat sekali: npx web-push generate-vapid-keys
 * PUSH_ENABLED=false mematikan notifikasi walau kunci VAPID terisi.
 * VAPID_SUBJECT wajib berupa mailto: atau https: yang bukan localhost; layanan push Apple (iPhone)
 * menolak semua notifikasi bila alamat kontak ini tidak valid. Bila kosong/tidak valid dipakai https://slm.lrmslm.com.
 */
export const DEFAULT_VAPID_SUBJECT = "https://slm.lrmslm.com";

export function validVapidSubject(value?: string) {
  const subject = value?.trim() ?? "";
  if (!/^(mailto:[^@\s]+@[^@\s]+\.[^@\s]+|https:\/\/[^\s/]+\.[^\s]+)$/i.test(subject)) return DEFAULT_VAPID_SUBJECT;
  return /localhost|127\.0\.0\.1|\.local\b/i.test(subject) ? DEFAULT_VAPID_SUBJECT : subject;
}

export function pushConfig(env: Record<string, string | undefined> = process.env) {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() || "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() || "";
  const subject = validVapidSubject(env.VAPID_SUBJECT);
  const off = env.PUSH_ENABLED?.trim().toLowerCase() === "false";
  return { enabled: !off && Boolean(publicKey && privateKey), publicKey, privateKey, subject };
}

/** Penerima per jenis notifikasi. */
export const PUSH_AUDIENCE = {
  newSale: ["OWNER", "SUPERVISOR"],
  lowStock: ["OWNER", "SUPERVISOR", "MANAGER"],
  tempoDue: ["OWNER", "SUPERVISOR", "FINANCE"],
  newDeliveryOrder: ["DELIVERY_DRIVER"],
  warehouseRequest: ["GUDANG"],
  warehouseShortage: ["OWNER"],
} as const;

/**
 * Notifikasi push (Web Push). Aktif bila kunci VAPID diisi di env server per instance:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mis. mailto:admin@domain)
 * Kunci dibuat sekali: npx web-push generate-vapid-keys
 * PUSH_ENABLED=false mematikan notifikasi walau kunci VAPID terisi.
 */
export function pushConfig(env: Record<string, string | undefined> = process.env) {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() || "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() || "";
  const subject = env.VAPID_SUBJECT?.trim() || "mailto:admin@localhost";
  const off = env.PUSH_ENABLED?.trim().toLowerCase() === "false";
  return { enabled: !off && Boolean(publicKey && privateKey), publicKey, privateKey, subject };
}

/** Penerima per jenis notifikasi. */
export const PUSH_AUDIENCE = {
  newSale: ["OWNER", "SUPERVISOR"],
  lowStock: ["OWNER", "SUPERVISOR", "MANAGER"],
  tempoDue: ["OWNER", "SUPERVISOR", "FINANCE"],
} as const;

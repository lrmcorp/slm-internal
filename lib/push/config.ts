/**
 * Notifikasi push (Web Push). Aktif bila kunci VAPID diisi di env server per instance:
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mis. mailto:admin@domain)
 * Kunci dibuat sekali: npx web-push generate-vapid-keys
 */
export function pushConfig(env: Record<string, string | undefined> = process.env) {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() || "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() || "";
  const subject = env.VAPID_SUBJECT?.trim() || "mailto:admin@localhost";
  return { enabled: Boolean(publicKey && privateKey), publicKey, privateKey, subject };
}

/** Penerima per jenis notifikasi. */
export const PUSH_AUDIENCE = {
  newSale: ["OWNER", "SUPERVISOR"],
  lowStock: ["OWNER", "SUPERVISOR", "MANAGER"],
} as const;

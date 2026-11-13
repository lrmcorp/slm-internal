/**
 * Fitur per instance. Satu image dipakai SLM, SLMJ, ANKJY, dan instance lain.
 *
 * CCTV hanya untuk domain SLM (bawaan slm.lrmslm.com; ubah lewat CCTV_ALLOWED_HOSTS, dipisah koma).
 * Domain lain tidak melihat menu, widget, halaman, maupun stream CCTV walau env-nya disalin dari SLM.
 *   CCTV_ENABLED=false  matikan CCTV juga di domain SLM.
 */
export const DEFAULT_CCTV_HOSTS = ["slm.lrmslm.com"];

type Env = Record<string, string | undefined>;

function allowedHosts(env: Env) {
  const list = (env.CCTV_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : DEFAULT_CCTV_HOSTS;
}

/** Host dari request (tanpa port). Nginx meneruskan Host asli. */
export function requestHost(headers: { get(name: string): string | null }) {
  const raw = headers.get("x-forwarded-host") || headers.get("host") || "";
  return raw.split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
}

export function cctvEnabled(env: Env = process.env, host?: string) {
  if (env.CCTV_ENABLED?.trim().toLowerCase() === "false") return false;
  if (host === undefined) return env.CCTV_ENABLED?.trim().toLowerCase() === "true";
  return allowedHosts(env).includes(host.trim().toLowerCase().replace(/:\d+$/, ""));
}

/**
 * DO (Surat Jalan / antrean packing). DELIVERY_ORDERS_ENABLED=false: penjualan tidak membuat DO dan
 * menu, halaman, serta tombol DO disembunyikan. Bawaan: aktif.
 */
export function deliveryOrdersEnabled(env: Env = process.env) {
  return env.DELIVERY_ORDERS_ENABLED?.trim().toLowerCase() !== "false";
}

/** Untuk server component dan route handler: CCTV aktif bila request datang ke domain SLM. */
export async function cctvEnabledForRequest() {
  const { headers } = await import("next/headers");
  // Di luar request (skrip, test) headers() melempar error: pakai aturan tanpa host.
  let list: Awaited<ReturnType<typeof headers>> | null = null;
  try {
    list = await headers();
  } catch {
    list = null;
  }
  return cctvEnabled(process.env, list ? requestHost(list) : undefined);
}

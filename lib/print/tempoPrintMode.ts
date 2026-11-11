import { requestHost } from "@/lib/features";

/**
 * Penjualan Tempo dicetak sebagai invoice penjualan biasa (bukan "Nota Tempo") khusus ANKJY.
 * Aktif bila aplikasi dibuka dari domain ANKJY (bawaan ankjy.net dan www.ankjy.net; ubah lewat
 * TEMPO_INVOICE_HOSTS, dipisah koma) atau PRINT_TEMPO_AS_INVOICE=true. PRINT_TEMPO_AS_INVOICE=false mematikannya.
 * Domain lain (SLM, MJ) tetap mencetak Nota Tempo.
 */
export const DEFAULT_TEMPO_INVOICE_HOSTS = ["ankjy.net", "www.ankjy.net"];

type Env = Record<string, string | undefined>;

export function tempoPrintsAsInvoice(env: Env = process.env, host?: string) {
  const flag = env.PRINT_TEMPO_AS_INVOICE?.trim().toLowerCase();
  if (flag === "true") return true;
  if (flag === "false" || !host) return false;
  const hosts = (env.TEMPO_INVOICE_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return (hosts.length ? hosts : DEFAULT_TEMPO_INVOICE_HOSTS).includes(host.trim().toLowerCase().replace(/:\d+$/, ""));
}

/** Untuk route handler: domain dari request. */
export function tempoPrintsAsInvoiceForRequest(request: Request) {
  return tempoPrintsAsInvoice(process.env, requestHost(request.headers) || new URL(request.url).hostname);
}

/** Untuk server component (halaman). */
export async function tempoPrintsAsInvoiceForPage() {
  const { headers } = await import("next/headers");
  try {
    return tempoPrintsAsInvoice(process.env, requestHost(await headers()));
  } catch {
    return tempoPrintsAsInvoice(process.env);
  }
}

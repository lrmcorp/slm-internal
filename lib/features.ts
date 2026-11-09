/**
 * Fitur per instance (env server). Satu image dipakai SLM, SLMJ, dan ANKJY.
 *   CCTV_ENABLED=false  sembunyikan seluruh fitur CCTV (dipakai ANKJY). Bawaan: aktif.
 */
export function cctvEnabled(env: Record<string, string | undefined> = process.env) {
  return env.CCTV_ENABLED?.trim().toLowerCase() !== "false";
}

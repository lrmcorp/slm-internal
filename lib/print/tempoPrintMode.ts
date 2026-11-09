/**
 * Per instance (server env): PRINT_TEMPO_AS_INVOICE=true membuat penjualan Tempo dicetak sebagai
 * invoice penjualan biasa, bukan "Nota Tempo". Dipakai ANKJY; instance lain tidak mengisinya.
 */
export function tempoPrintsAsInvoice(env: Record<string, string | undefined> = process.env) {
  return env.PRINT_TEMPO_AS_INVOICE?.trim().toLowerCase() === "true";
}

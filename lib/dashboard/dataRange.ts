const dayPattern = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;

/**
 * Tanggal paling awal (YYYY-MM-DD) yang dibutuhkan dashboard: grafik performa (rentang filter, atau
 * 6 bulan sampai bulan "to"/bulan ini), periode pembayaran, dan bulan berjalan. Data sebelum tanggal ini
 * tidak dimuat supaya dashboard tetap cepat walau riwayat transaksi bertambah.
 */
export function dashboardDataFrom(filters: { from?: string; to?: string }, paymentFrom: string | undefined, monthKey: string) {
  const minusMonths = (key: string, n: number) => {
    const [y, m] = key.slice(0, 7).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 10);
  };
  const chartFrom = filters.from && dayPattern.test(filters.from)
    ? `${filters.from.slice(0, 7)}-01`
    : minusMonths(filters.to && dayPattern.test(filters.to) ? filters.to : monthKey, 5);
  const candidates = [chartFrom, `${monthKey}-01`, ...(paymentFrom && dayPattern.test(paymentFrom) ? [paymentFrom] : [])];
  return candidates.sort()[0];
}

/** Tampil seketika saat aplikasi dibuka, selagi data dashboard dimuat dari server. */
export default function DashboardLoading() {
  return (
    <main className="min-h-screen p-5 sm:p-8 lg:p-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Memuat dashboard…</span>
      <div className="animate-pulse motion-reduce:animate-none">
        <div className="mb-8 flex items-center justify-between border-b border-neutral-300 pb-5">
          <div className="h-6 w-40 rounded bg-neutral-200" />
          <div className="h-9 w-32 rounded bg-neutral-200" />
        </div>
        <div className="mb-6 flex items-center justify-between">
          <div className="h-8 w-56 rounded bg-neutral-200" />
          <div className="h-10 w-36 rounded bg-neutral-200" />
        </div>
        <div className="aj-surface mb-6 divide-y divide-neutral-100">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-4">
              <div className="h-4 w-28 rounded bg-neutral-200" />
              <div className="flex gap-10">
                <div className="h-4 w-24 rounded bg-neutral-200" />
                <div className="hidden h-4 w-24 rounded bg-neutral-200 sm:block" />
              </div>
            </div>
          ))}
        </div>
        <div className="aj-surface h-64" />
      </div>
    </main>
  );
}

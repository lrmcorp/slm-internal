import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { Input } from "@/components/ui/Input";
import { ResponsiveFilterPanel } from "@/components/ui/ResponsiveFilterPanel";
import { can } from "@/lib/auth/roles";
import { getCurrentUser } from "@/lib/auth/session";
import type { SalesRecordFilters } from "@/lib/sales/store";
import { listSalesRecordsPageForUser } from "@/lib/sales/access";
import { SalesHistoryList } from "@/components/transactions/SalesHistoryList";
import { productNamesBySku } from "@/lib/inventory/catalog";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const PAGE_SIZE = 15;

function valueOf(params: SearchParams, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function pageHref(params: SearchParams, page: number) {
  const next = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value && key !== "page") next.set(key, value);
  }
  next.set("page", String(page));
  return `/penjualan/draft?${next.toString()}`;
}

export default async function DraftPenjualanPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const user = await getCurrentUser();
  const role = user.role;
  if (!can(role, "penjualan.create") && !can(role, "reports.view")) redirect("/");

  const canManage = can(role, "penjualan.manage");
  const params = (await searchParams) || {};
  const page = Math.max(1, Number(valueOf(params, "page") || "1"));

  const filters: SalesRecordFilters = {
    from: valueOf(params, "from") || undefined,
    to: valueOf(params, "to") || undefined,
    keyword: valueOf(params, "keyword") || undefined,
    approvalStatus: "draft",
  };

  const { data: drafts, meta } = await listSalesRecordsPageForUser(user, {
    page,
    pageSize: PAGE_SIZE,
    filters,
  });

  const canViewTransactionNumber = role === "OWNER";
  const productNames = await productNamesBySku(drafts.flatMap((sale) => sale.items.map((item) => item.productRef)));
  const totalPages = meta.totalPages;
  const activeFilters = [
    valueOf(params, "from") ? `Dari ${valueOf(params, "from")}` : null,
    valueOf(params, "to") ? `Sampai ${valueOf(params, "to")}` : null,
    valueOf(params, "keyword") ? `Keyword: ${valueOf(params, "keyword")}` : null,
  ].filter(Boolean) as string[];

  return (
    <AppShell>
      <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-amber-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-amber-900">
              Draft Mode
            </span>
            <p className="text-xs font-bold uppercase tracking-[0.13em] text-slate-500">Operasional</p>
          </div>
          <h2 className="aj-page-title text-3xl font-bold">Draft Penjualan</h2>
          <p className="mt-2 text-sm text-slate-600">
            Daftar pesanan sementara yang belum difinalisasi. Stok barang di gudang SLM{" "}
            <span className="font-semibold text-rose-700">belum dipotong</span>.
          </p>
        </div>
        {can(role, "penjualan.create") && (
          <Link
            href="/penjualan/input"
            className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700"
          >
            + Input Penjualan Baru
          </Link>
        )}
      </div>

      <ResponsiveFilterPanel
        title="Filter draft"
        resetHref="/penjualan/draft"
        activeFilters={activeFilters}
        emptyText="Semua draft aktif."
        className="mb-5"
        formClassName="grid gap-3 md:grid-cols-3 xl:grid-cols-4"
        actionsClassName="md:col-span-3 xl:col-span-4"
      >
        <label className="text-sm font-medium text-slate-700">
          Dari tanggal
          <Input type="date" name="from" defaultValue={valueOf(params, "from") || ""} className="mt-1" />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Sampai tanggal
          <Input type="date" name="to" defaultValue={valueOf(params, "to") || ""} className="mt-1" />
        </label>
        <label className="text-sm font-medium text-slate-700 md:col-span-2">
          Keyword
          <Input
            name="keyword"
            defaultValue={valueOf(params, "keyword") || ""}
            placeholder="Cari nama customer / catatan..."
            className="mt-1"
          />
        </label>
      </ResponsiveFilterPanel>

      <section className="aj-surface overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 text-sm text-slate-600">
          <div>
            Menampilkan <span className="font-semibold text-slate-900">{drafts.length}</span> dari total{" "}
            <span className="font-semibold text-slate-900">{meta.total}</span> draft pesanan.
          </div>
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 border border-amber-200">
            Status: Draf Belum Terpotong Stok
          </span>
        </div>

        {/* Sama persis dengan Riwayat Penjualan; untuk draft tombol Edit menjadi Lanjutkan. */}
        <SalesHistoryList sales={drafts} canManage={canManage} canViewTransactionNumber={canViewTransactionNumber} productNames={productNames} canContinueDraft={can(role, "penjualan.create")} />
        {drafts.length === 0 && (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            Belum ada draft. <Link href="/penjualan/input" className="font-semibold text-brand-700 underline">Input penjualan baru</Link>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4 text-sm">
            <span className="text-slate-500">
              Halaman {page} dari {totalPages}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  className="rounded-sm border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
                  href={pageHref(params, page - 1)}
                >
                  Sebelumnya
                </Link>
              )}
              {page < totalPages && (
                <Link
                  className="rounded-sm border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50"
                  href={pageHref(params, page + 1)}
                >
                  Berikutnya
                </Link>
              )}
            </div>
          </div>
        )}
      </section>
    </AppShell>
  );
}

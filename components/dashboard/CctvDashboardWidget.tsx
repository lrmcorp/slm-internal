"use client";

import { useState } from "react";
import Link from "next/link";
import { formatJakartaDateTime } from "@/lib/date/jakarta";
import { CctvImageModal } from "@/components/cctv/CctvImageModal";
import { CctvLivePlayer } from "@/components/cctv/CctvLivePlayer";
import {
  getConfiguredCameraStreams,
  type CctvCameraStream,
} from "@/lib/cctv/streams";
import type { CctvSystemStatusResponse } from "@/lib/cctv/client";

export interface CctvDashboardSummaryData {
  today: {
    totalPacked: number;
    totalDetections: number;
    totalAnomalies: number;
  };
  recentPacked: Array<{
    id: string;
    invoiceNumber?: string | null;
    customerName?: string | null;
    cameraName?: string | null;
    screenshotPhotoUrl?: string | null;
    evidenceUrl?: string | null;
    createdAt: Date | string;
    packingCompletedAt?: Date | string | null;
    salesRecord?: {
      id: string;
      transactionNumber?: string | null;
      customerName: string;
      total: any;
    } | null;
  }>;
  liveSystem?: CctvSystemStatusResponse | {
    status?: string;
    cameras?: Array<{
      id?: number | string;
      name: string;
      status: string;
      fps?: number;
      location?: string;
      fresh?: boolean;
    }>;
  } | null;
  cameraStreams?: CctvCameraStream[];
}

function CctvThumbnail({
  src,
  alt,
  className,
  fallbackSize = "h-9 w-9",
  iconSize = "w-4 h-4",
}: {
  src: string;
  alt: string;
  className?: string;
  fallbackSize?: string;
  iconSize?: string;
}) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className={`flex ${fallbackSize} shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 text-slate-300`}>
        <svg className={iconSize} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setError(true)}
    />
  );
}

export function CctvDashboardWidget({
  summary,
  cameraStreams,
}: {
  summary: CctvDashboardSummaryData;
  cameraStreams?: CctvCameraStream[];
}) {
  // Live player tertutup dulu: kartu video besar membuat dashboard panjang di HP.
  const [showLiveStream, setShowLiveStream] = useState<boolean>(false);

  const totalPacked = summary?.today?.totalPacked ?? 0;
  const totalDetections = summary?.today?.totalDetections ?? 0;
  const totalAnomalies = summary?.today?.totalAnomalies ?? 0;
  const recentPacked = summary?.recentPacked ?? [];

  const streams =
    cameraStreams ||
    summary?.cameraStreams ||
    getConfiguredCameraStreams(summary?.liveSystem?.cameras as any);

  // Status per kamera: dari sistem CCTV bila ada, kalau tidak dari daftar stream.
  const cameras = (summary?.liveSystem?.cameras?.length
    ? summary.liveSystem.cameras.map((c) => ({ id: String(c.id ?? c.name), name: c.name, online: c.status === "online" }))
    : streams.map((c) => ({ id: String(c.id), name: c.name, online: c.isOnline })));
  const onlineCount = cameras.filter((c) => c.online).length;
  const allOffline = cameras.length > 0 && onlineCount === 0;

  const stats = [
    { label: "Dipacking", value: totalPacked, tone: "text-brand-700" },
    { label: "Deteksi", value: totalDetections, tone: "text-slate-900" },
    { label: "Anomali", value: totalAnomalies, tone: totalAnomalies > 0 ? "text-rose-600" : "text-slate-900" },
  ];

  return (
    <section className="aj-surface mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
      {/* Judul, status kamera, dan tautan dalam satu baris */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="text-base font-bold tracking-tight text-slate-900">CCTV Meja Packing</h3>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold ${
              allOffline ? "border-amber-200 bg-amber-50 text-amber-800" : "border-brand-200 bg-brand-50 text-brand-800"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${allOffline ? "bg-amber-500" : "bg-brand-600"}`} />
            {cameras.length ? `${onlineCount}/${cameras.length} kamera online` : "Belum ada kamera"}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs font-bold">
          <Link href="/cctv-monitoring" className="inline-flex min-h-9 items-center text-slate-600 underline-offset-4 hover:underline">Monitoring</Link>
          <Link href="/reports/cctv" className="inline-flex min-h-9 items-center text-brand-700 underline-offset-4 hover:underline">Laporan CCTV →</Link>
        </div>
      </div>

      {/* Angka hari ini: satu baris ringkas */}
      <dl className="mt-3 grid grid-cols-3 divide-x divide-slate-200 rounded-xl border border-slate-200 bg-slate-50/70">
        {stats.map((stat) => (
          <div key={stat.label} className="px-3 py-2.5">
            <dt className="truncate text-[11px] font-semibold text-slate-500">{stat.label}</dt>
            <dd className={`text-xl font-black tabular-nums ${stat.tone}`}>{stat.value}</dd>
          </div>
        ))}
      </dl>

      {/* Kamera: satu baris per kamera; live player dibuka bila perlu */}
      {cameras.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {cameras.map((camera) => (
            <span key={camera.id} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700">
              <span className={`h-2 w-2 rounded-full ${camera.online ? "bg-brand-500" : "bg-slate-300"}`} />
              {camera.name}
              <span className={camera.online ? "text-brand-700" : "text-slate-400"}>{camera.online ? "Online" : "Offline"}</span>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setShowLiveStream((prev) => !prev)}
            aria-expanded={showLiveStream}
            className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-bold text-white hover:bg-brand-700"
          >
            {showLiveStream ? "Tutup live" : "Tonton live"}
          </button>
        </div>
      )}

      {showLiveStream && (
        <div className="mt-3">
          <CctvLivePlayer cameras={streams} autoPlay={true} />
        </div>
      )}

      {/* Paket terakhir: geser ke samping di HP, 5 kolom di layar lebar */}
      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="mb-2 flex items-baseline justify-between">
          <h4 className="text-xs font-bold text-slate-600">Paket terakhir dipacking</h4>
          {recentPacked.length > 0 && <span className="text-[11px] text-slate-400">{recentPacked.length} terakhir</span>}
        </div>

        {recentPacked.length > 0 ? (
          <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 lg:grid lg:grid-cols-5 lg:overflow-visible">
            {recentPacked.map((item) => {
              const photo = item.screenshotPhotoUrl || item.evidenceUrl;
              const sale = item.salesRecord;
              const time = formatJakartaDateTime(item.packingCompletedAt || item.createdAt).slice(-8);

              return (
                <div key={item.id} className="flex w-56 shrink-0 snap-start items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/60 p-2 lg:w-auto">
                  {photo ? (
                    <CctvImageModal
                      imageUrl={photo}
                      title={`Paket: #${item.invoiceNumber || "CCTV"}`}
                      subtitle={`${item.cameraName || "Meja Packing"} • ${formatJakartaDateTime(item.createdAt)}`}
                      trigger={
                        <div className="h-11 w-11 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
                          <CctvThumbnail src={photo} alt="Bukti foto" className="h-full w-full object-cover" fallbackSize="h-11 w-11" iconSize="w-5 h-5" />
                        </div>
                      }
                    />
                  ) : (
                    <div className="h-11 w-11 shrink-0 rounded-lg border border-dashed border-slate-200 bg-white" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    {sale ? (
                      <Link href={`/penjualan/${sale.id}`} className="block truncate font-mono text-xs font-bold text-brand-700 hover:underline">
                        {sale.transactionNumber || item.invoiceNumber || sale.id}
                      </Link>
                    ) : (
                      <p className="truncate font-mono text-xs font-bold text-slate-800">{item.invoiceNumber || "—"}</p>
                    )}
                    <p className="truncate text-[11px] text-slate-600">{sale?.customerName || item.customerName || "Customer umum"}</p>
                    <p className="truncate text-[10px] text-slate-400">{item.cameraName || "Meja 1"} · {time}</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-500">Belum ada paket yang dipacking hari ini.</p>
        )}
      </div>
    </section>
  );
}

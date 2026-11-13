"use client";

import { useEffect, useState } from "react";
import { useBrand } from "@/components/brand/BrandProvider";

/** Link unduh APK, hanya untuk browser HP Android (tidak tampil di dalam aplikasi Android sendiri). */
export function AndroidAppLink() {
  const brand = useBrand();
  // Satu kode dipakai beberapa instance; tiap instance punya APK sendiri (android/README.md).
  const app = /ankjy/i.test(`${brand.name} ${brand.initials}`) ? { file: "ankjy-android.apk", name: "ANKJY" } : { file: "slm-android.apk", name: "SLM" };
  const [show, setShow] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent;
    setShow(/Android/i.test(ua) && !/SLMAndroid/.test(ua));
  }, []);
  // SLMJ belum punya APK sendiri; APK SLM membuka slm.lrmslm.com, jadi jangan ditawarkan di SLMJ.
  if (!show || brand.iconSlug === "slmj") return null;
  return (
    <a
      href={`/downloads/${app.file}`}
      download
      className="mt-4 flex min-h-11 items-center justify-center rounded-sm border border-brand-600 px-4 text-sm font-bold text-brand-700 hover:bg-brand-50"
    >
      Unduh aplikasi Android {app.name}
    </a>
  );
}

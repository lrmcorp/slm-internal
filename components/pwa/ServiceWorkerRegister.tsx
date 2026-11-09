"use client";

import { useEffect } from "react";

/** Daftarkan service worker (simpanan file aplikasi + notifikasi) di produksi. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}

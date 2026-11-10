"use client";

import { useEffect, useRef, useState } from "react";

const TRIGGER = 70;
const MAX = 110;

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Ada elemen yang bisa digulir dan belum di posisi paling atas (mis. isi modal): tarikan milik elemen itu. */
function insideScrolledArea(target: EventTarget | null) {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.body) {
    if (el.scrollTop > 0) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Tarik ke bawah untuk muat ulang. Hanya di aplikasi yang dipasang ke layar utama (iPhone tidak punya
 * tombol muat ulang di mode itu). Di browser biasa tidak aktif karena browser sudah punya fiturnya.
 */
export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [reloading, setReloading] = useState(false);
  const start = useRef<number | null>(null);
  const distance = useRef(0);

  useEffect(() => {
    if (!isStandalone()) return;
    const onStart = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 && e.touches.length === 1 && !insideScrolledArea(e.target) ? e.touches[0].clientY : null;
      distance.current = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return;
      const dy = e.touches[0].clientY - start.current;
      if (dy <= 0 || window.scrollY > 0) { distance.current = 0; setPull(0); return; }
      distance.current = Math.min(MAX, dy * 0.6);
      setPull(distance.current);
    };
    const onEnd = () => {
      if (start.current !== null && distance.current >= TRIGGER) {
        setReloading(true);
        window.location.reload();
      } else {
        setPull(0);
      }
      start.current = null;
      distance.current = 0;
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  if (!pull && !reloading) return null;
  const ready = reloading || pull >= TRIGGER;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[100] flex justify-center"
      style={{ top: `calc(env(safe-area-inset-top) + ${Math.max(8, (reloading ? TRIGGER : pull) - 36)}px)` }}
    >
      <span className={`rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm ${ready ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-700"}`}>
        {reloading ? "Memuat ulang..." : ready ? "Lepas untuk muat ulang" : "Tarik untuk muat ulang"}
      </span>
    </div>
  );
}

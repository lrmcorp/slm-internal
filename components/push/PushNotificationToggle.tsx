"use client";

import { useEffect, useState } from "react";

type State = "loading" | "unsupported" | "needs-install" | "denied" | "off" | "on" | "busy";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Aktifkan / matikan notifikasi push di perangkat ini. */
export function PushNotificationToggle({ publicKey, topics }: { publicKey: string; topics: string[] }) {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported) {
      setState(isIos() && !isStandalone() ? "needs-install" : "unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    navigator.serviceWorker.getRegistration("/").then(async (registration) => {
      const subscription = await registration?.pushManager.getSubscription();
      setState(subscription ? "on" : "off");
    }).catch(() => setState("off"));
  }, []);

  async function enable() {
    setError("");
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const subscription = (await registration.pushManager.getSubscription())
        ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      const response = await fetch("/api/push/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON()) });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || "Gagal menyimpan langganan.");
      setState("on");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Notifikasi belum bisa diaktifkan.");
      setState("off");
    }
  }

  async function disable() {
    setError("");
    setState("busy");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await fetch("/api/push/subscription", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => undefined);
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      setState("on");
    }
  }

  return (
    <div className="px-5 py-4 sm:px-6">
      <p className="text-sm font-semibold text-neutral-900">Notifikasi di perangkat ini</p>
      <p className="mt-1 text-sm text-neutral-600">Anda akan menerima: {topics.join(", ")}.</p>
      {state === "needs-install" && (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Di iPhone, pasang dulu ke layar utama: buka di Safari, tekan <b>Bagikan</b>, pilih <b>Tambah ke Layar Utama</b>, lalu buka SLM dari ikon tersebut dan kembali ke halaman ini.
        </p>
      )}
      {state === "unsupported" && <p className="mt-3 text-sm text-neutral-600">Browser ini tidak mendukung notifikasi. Di iPhone gunakan iOS 16.4 atau lebih baru.</p>}
      {state === "denied" && (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Notifikasi diblokir. Aktifkan di Pengaturan HP &gt; Notifikasi &gt; SLM, lalu buka halaman ini lagi.</p>
      )}
      {(state === "off" || state === "on" || state === "busy") && (
        <button
          type="button"
          onClick={state === "on" ? disable : enable}
          disabled={state === "busy"}
          className={`mt-3 inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold disabled:opacity-60 ${state === "on" ? "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50" : "bg-brand-700 text-white hover:bg-brand-800"}`}
        >
          {state === "busy" ? "Memproses…" : state === "on" ? "Matikan notifikasi" : "Aktifkan notifikasi"}
        </button>
      )}
      {state === "on" && <p className="mt-2 text-xs text-brand-800">Aktif di perangkat ini.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
    </div>
  );
}

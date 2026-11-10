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

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array) {
  if (!a) return true;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

/** Simpan / perbarui langganan di server. Juga memulihkan langganan yang sempat terhapus di server. */
async function saveSubscription(subscription: PushSubscription) {
  const response = await fetch("/api/push/subscription", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON()) });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || "Gagal menyimpan langganan.");
}

/** Langganan aktif dengan kunci server yang sekarang; dibuat ulang bila kunci server sudah diganti. */
async function currentSubscription(registration: ServiceWorkerRegistration, publicKey: string) {
  const key = urlBase64ToUint8Array(publicKey);
  const existing = await registration.pushManager.getSubscription();
  if (existing && sameKey(existing.options?.applicationServerKey, key)) return existing;
  if (existing) await existing.unsubscribe().catch(() => undefined);
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Aktifkan / matikan notifikasi push di perangkat ini. */
export function PushNotificationToggle({ publicKey, topics }: { publicKey: string; topics: string[] }) {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState("");
  const [testResult, setTestResult] = useState("");
  const [testing, setTesting] = useState(false);

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
      if (!registration || !subscription) return setState("off");
      setState("on");
      // Pastikan server masih menyimpan perangkat ini (bisa terhapus setelah gagal kirim) dan kuncinya cocok.
      if (Notification.permission === "granted") {
        const fresh = await currentSubscription(registration, publicKey);
        await saveSubscription(fresh);
      }
    }).catch(() => undefined);
  }, [publicKey]);

  async function sendTest() {
    setTesting(true);
    setTestResult("");
    try {
      const response = await fetch("/api/push/test", { method: "POST" });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.success) return setTestResult(json?.message || "Gagal mengirim notifikasi uji.");
      const r = json.data as { devices: number; sent: number; failures: { status?: number; reason: string; device: string }[] };
      if (r.devices === 0) setTestResult("Server belum menyimpan perangkat Anda. Tekan Matikan lalu Aktifkan notifikasi lagi.");
      else if (r.failures.length === 0) setTestResult(`Terkirim ke ${r.sent} perangkat. Notifikasi uji akan muncul beberapa detik lagi.`);
      else setTestResult(`Terkirim ${r.sent} dari ${r.devices} perangkat. Gagal: ${r.failures.map((f) => `${f.device} (${f.status ?? "-"} ${f.reason})`).join("; ")}`);
    } catch {
      setTestResult("Koneksi terputus. Coba lagi.");
    } finally {
      setTesting(false);
    }
  }

  async function enable() {
    setError("");
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const registration = await navigator.serviceWorker.ready;
      await saveSubscription(await currentSubscription(registration, publicKey));
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
      {state === "on" && (
        <>
          <p className="mt-2 text-xs text-brand-800">Aktif di perangkat ini.</p>
          <button
            type="button"
            onClick={sendTest}
            disabled={testing}
            className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-brand-300 bg-brand-50 px-4 text-sm font-semibold text-brand-800 hover:bg-brand-100 disabled:opacity-60"
          >
            {testing ? "Mengirim…" : "Kirim notifikasi uji"}
          </button>
          {testResult && <p role="status" className="mt-2 text-sm text-neutral-700">{testResult}</p>}
        </>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
    </div>
  );
}

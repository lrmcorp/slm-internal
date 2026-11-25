/**
 * Pemutar live realtime untuk MP4 bertahap (fragmented MP4) dari relay go2rtc lewat
 * /api/cctv/stream/[id]/realtime. Video tidak di-decode ulang di server; browser memutarnya lewat
 * Media Source Extensions dan selalu dijaga dekat ujung siaran (jeda sekitar 1 detik).
 * Bila browser tidak mendukung (mis. codec H.265 tanpa dukungan perangkat), start() gagal dan
 * pemanggil kembali ke HLS.
 */

/** Codec dari header Content-Type, mis. video/mp4; codecs="avc1.420029". */
export function codecFromContentType(type: string | null | undefined): string | null {
  const match = /codecs\s*=\s*"?([^";]+)"?/i.exec(type || "");
  return match ? match[1].trim() : null;
}

function indexOfAscii(bytes: Uint8Array, text: string): number {
  const codes = Array.from(text, (char) => char.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - codes.length; i++) {
    for (let j = 0; j < codes.length; j++) if (bytes[i + j] !== codes[j]) continue outer;
    return i;
  }
  return -1;
}

const hex = (value: number) => value.toString(16).padStart(2, "0");

/** Codec dari kotak init MP4 (moov): avcC untuk H.264, hvcC untuk H.265, mp4a untuk AAC. */
export function codecFromInit(bytes: Uint8Array): string | null {
  const codecs: string[] = [];
  const avc = indexOfAscii(bytes, "avcC");
  if (avc >= 0 && avc + 8 <= bytes.length) {
    codecs.push(`avc1.${hex(bytes[avc + 5])}${hex(bytes[avc + 6])}${hex(bytes[avc + 7])}`);
  } else if (indexOfAscii(bytes, "hvcC") >= 0) {
    codecs.push("hvc1.1.6.L120.90");
  }
  if (!codecs.length) return null;
  if (indexOfAscii(bytes, "mp4a") >= 0) codecs.push("mp4a.40.2");
  return codecs.join(",");
}

type MediaSourceCtor = typeof MediaSource;

function mediaSourceCtor(): MediaSourceCtor | null {
  if (typeof window === "undefined") return null;
  const managed = (window as unknown as { ManagedMediaSource?: MediaSourceCtor }).ManagedMediaSource;
  return managed || window.MediaSource || null;
}

export function realtimeSupported(): boolean {
  return Boolean(mediaSourceCtor()) && typeof ReadableStream !== "undefined";
}

/** /api/cctv/stream/14/hls/stream.m3u8 -> /api/cctv/stream/14/realtime; null bila bukan URL proxy SLM. */
export function realtimeUrlFor(streamUrl: string | null | undefined): string | null {
  if (!streamUrl) return null;
  const match = /^(\/api\/cctv\/stream\/[0-9]{1,6})\/hls\/stream\.m3u8$/.exec(streamUrl);
  return match ? `${match[1]}/realtime` : null;
}

const FIRST_DATA_TIMEOUT_MS = 10000;
/** Lebih jauh dari ini di belakang ujung siaran, lompat maju. */
const MAX_LATENCY_SECONDS = 1.5;
const TARGET_LATENCY_SECONDS = 0.4;
/** Buffer yang disimpan di belakang posisi putar (memori kecil). */
const KEEP_BEHIND_SECONDS = 6;

export interface RealtimePlayerOptions {
  /** Siaran berhenti setelah sempat tampil (server putus, jaringan, dsb.). */
  onEnded?: (error?: unknown) => void;
}

export class RealtimeMp4Player {
  private controller = new AbortController();
  private objectUrl: string | null = null;
  private stopped = false;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly url: string,
    private readonly options: RealtimePlayerOptions = {}
  ) {}

  /** Selesai saat gambar pertama siap diputar. Gagal bila sumber/codec tidak tersedia. */
  async start(): Promise<void> {
    const Ctor = mediaSourceCtor();
    if (!Ctor) throw new Error("MediaSource tidak tersedia");
    const timer = setTimeout(() => this.controller.abort(), FIRST_DATA_TIMEOUT_MS);
    try {
      const response = await fetch(this.url, { signal: this.controller.signal, cache: "no-store" });
      const type = response.headers.get("content-type") || "";
      if (!response.ok || !response.body || !type.startsWith("video/mp4")) {
        throw new Error(`Live realtime belum tersedia (HTTP ${response.status})`);
      }
      const reader = response.body.getReader();
      let head: Uint8Array = new Uint8Array(0);
      let codec = codecFromContentType(type);
      while (!codec || head.length === 0) {
        const { value, done } = await reader.read();
        if (done) throw new Error("Siaran berakhir sebelum gambar pertama");
        head = concat(head, value);
        codec = codec || codecFromInit(head);
        if (!codec && head.length > 512 * 1024) throw new Error("Format video tidak dikenali");
      }
      const mime = `video/mp4; codecs="${codec}"`;
      if (!Ctor.isTypeSupported(mime)) throw new Error(`Browser tidak mendukung ${codec}`);

      const source = new Ctor();
      if ((window as unknown as { ManagedMediaSource?: unknown }).ManagedMediaSource === Ctor) {
        // Wajib untuk ManagedMediaSource (Safari iOS).
        (this.video as HTMLVideoElement & { disableRemotePlayback: boolean }).disableRemotePlayback = true;
      }
      this.objectUrl = URL.createObjectURL(source);
      this.video.src = this.objectUrl;
      await new Promise<void>((resolve) => source.addEventListener("sourceopen", () => resolve(), { once: true }));
      const buffer = source.addSourceBuffer(mime);
      buffer.mode = "segments";

      const queue: Uint8Array[] = [head];
      let firstFrame: () => void = () => {};
      const ready = new Promise<void>((resolve) => (firstFrame = resolve));
      const pump = () => {
        if (this.stopped || buffer.updating || source.readyState !== "open") return;
        // Membuang buffer lama juga memakai SourceBuffer: lanjutkan setelah updateend berikutnya.
        if (this.keepNearLiveEdge(buffer)) return;
        const next = queue.shift();
        if (!next) return;
        try {
          buffer.appendBuffer(next as BufferSource);
        } catch (error) {
          if ((error as { name?: string })?.name === "QuotaExceededError" && buffer.buffered.length) {
            queue.unshift(next);
            buffer.remove(0, Math.max(0, this.video.currentTime - 1));
            return;
          }
          this.fail(error);
        }
      };
      buffer.addEventListener("updateend", () => {
        if (buffer.buffered.length) firstFrame();
        pump();
      });
      pump();

      void (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            queue.push(value);
            pump();
          }
          this.fail(new Error("Siaran berakhir"));
        } catch (error) {
          this.fail(error);
        }
      })();

      await ready;
      clearTimeout(timer);
      await this.video.play().catch(() => undefined);
    } catch (error) {
      clearTimeout(timer);
      this.stop();
      throw error;
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.controller.abort();
    if (this.objectUrl) {
      this.video.pause();
      this.video.removeAttribute("src");
      this.video.load();
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  private fail(error: unknown): void {
    if (this.stopped) return;
    this.stop();
    this.options.onEnded?.(error);
  }

  /** Lompat ke dekat ujung bila tertinggal (mis. tab sempat tersendat) dan buang buffer lama. */
  private keepNearLiveEdge(buffer: SourceBuffer): boolean {
    const ranges = buffer.buffered;
    if (!ranges.length) return false;
    const end = ranges.end(ranges.length - 1);
    const video = this.video;
    if (end - video.currentTime > MAX_LATENCY_SECONDS || video.currentTime < ranges.start(0)) {
      video.currentTime = Math.max(ranges.start(ranges.length - 1), end - TARGET_LATENCY_SECONDS);
    }
    if (video.currentTime - ranges.start(0) > KEEP_BEHIND_SECONDS * 2) {
      buffer.remove(0, video.currentTime - KEEP_BEHIND_SECONDS);
      return true;
    }
    return false;
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

import { describe, expect, it } from "vitest";
import { codecFromContentType, codecFromInit, realtimeUrlFor } from "@/lib/cctv/realtimePlayer";

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

describe("live realtime CCTV", () => {
  it("memetakan URL HLS proxy SLM ke jalur realtime, URL lain tidak", () => {
    expect(realtimeUrlFor("/api/cctv/stream/14/hls/stream.m3u8", true)).toBe("/api/cctv/stream/14/realtime");
    expect(realtimeUrlFor("/api/cctv/stream/14/hls/stream.m3u8", false)).toBe("/api/cctv/stream/14/realtime?codec=h264");
    expect(realtimeUrlFor("https://cctv.example.com/live/stream.m3u8")).toBeNull();
    expect(realtimeUrlFor("/api/cctv/stream/14/live")).toBeNull();
    expect(realtimeUrlFor(null)).toBeNull();
  });

  it("membaca codec dari Content-Type go2rtc", () => {
    expect(codecFromContentType('video/mp4; codecs="avc1.420029"; charset=utf-8')).toBe("avc1.420029");
    expect(codecFromContentType("video/mp4")).toBeNull();
  });

  it("membaca codec H.264, H.265 dan AAC dari kotak init MP4", () => {
    const avc = new Uint8Array([0, 0, 0, 0, ...ascii("avcC"), 1, 0x64, 0x00, 0x1f, 0xff]);
    expect(codecFromInit(avc)).toBe("avc1.64001f");
    const withAudio = new Uint8Array([...avc, ...ascii("mp4a")]);
    expect(codecFromInit(withAudio)).toBe("avc1.64001f,mp4a.40.2");
    expect(codecFromInit(new Uint8Array(ascii("....hvcC....")))).toBe("hvc1.1.6.L120.90");
    expect(codecFromInit(new Uint8Array(ascii("ftypisom")))).toBeNull();
  });
});

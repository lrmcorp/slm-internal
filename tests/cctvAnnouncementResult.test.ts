import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { announcementResultMessage, parseAnnouncementResult, verifyCctvRequest } = await import("@/lib/cctv/announcementResult");

const speakers = [{ channel: 12, name: "Gudang (laporan pesanan)" }, { channel: 15, name: "Toko depan" }];

describe("hasil pemutaran pengumuman CCTV", () => {
  it("menerima token CCTV lewat header, Bearer, atau HMAC; menolak yang lain", () => {
    const body = JSON.stringify({ report: "do-backlog" });
    const req = (headers: Record<string, string>) => new Request("http://x/api/cctv/announcements/result", { method: "POST", headers, body });
    expect(verifyCctvRequest(req({ "X-CCTV-Token": "tok" }), body, "tok")).toBe(true);
    expect(verifyCctvRequest(req({ Authorization: "Bearer tok" }), body, "tok")).toBe(true);
    const sig = `sha256=${crypto.createHmac("sha256", "tok").update(body).digest("hex")}`;
    expect(verifyCctvRequest(req({ "X-CCTV-Signature": sig }), body, "tok")).toBe(true);
    expect(verifyCctvRequest(req({ "X-CCTV-Token": "salah" }), body, "tok")).toBe(false);
    expect(verifyCctvRequest(req({}), body, "")).toBe(false);
  });

  it("membaca laporan dan membuang kanal yang tidak valid", () => {
    expect(parseAnnouncementResult({ report: "do-backlog", played_channels: [12, 12, "15", 99], failed_channels: [] }))
      .toEqual({ report: "do-backlog", played: [12, 15], failed: [], error: null });
    expect(parseAnnouncementResult({ report: "Bukan Valid" })).toBeNull();
    expect(parseAnnouncementResult(null)).toBeNull();
  });

  it("pesan Owner: berhasil semua, sebagian gagal, dan gagal semua", () => {
    expect(announcementResultMessage({ report: "do-backlog", played: [12, 15], failed: [], error: null }, speakers, "12.31"))
      .toEqual({ title: "Laporan pesanan 12.31 sudah diumumkan", body: "Diputar di speaker Gudang (laporan pesanan) dan Toko depan." });
    expect(announcementResultMessage({ report: "do-backlog", played: [12], failed: [15], error: null }, speakers, "15.01").body)
      .toBe("Diputar di Gudang (laporan pesanan). Gagal di Toko depan.");
    const failed = announcementResultMessage({ report: "do-backlog", played: [], failed: [12, 7], error: "RuntimeException" }, speakers, "15.01");
    expect(failed.title).toBe("Laporan pesanan 15.01 gagal diumumkan");
    expect(failed.body).toContain("Gudang (laporan pesanan) dan kanal 7");
  });
});

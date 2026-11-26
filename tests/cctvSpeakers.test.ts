import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

const { normalizeSpeakers, DEFAULT_SPEAKERS, backlogSpeakerChannels } = await import("@/lib/cctv/speakers");

describe("speaker CCTV untuk pengumuman", () => {
  it("bawaan tanpa kanal 13; laporan pesanan di kanal 12 dan 15, bisa diubah lewat env", () => {
    expect(DEFAULT_SPEAKERS.map((s) => s.channel)).toEqual([1, 2, 5, 6, 12, 15]);
    expect(DEFAULT_SPEAKERS.find((s) => s.channel === 12)?.name).toContain("laporan pesanan");
    expect(backlogSpeakerChannels({})).toEqual([12, 15]);
    expect(backlogSpeakerChannels({ CCTV_ANNOUNCE_CHANNELS: "15, 15, x, 99, 2" })).toEqual([15, 2]);
  });

  it("merapikan nama: kanal ganda/tidak sah dibuang, nama kosong diberi nama kanal, urut per kanal", () => {
    expect(normalizeSpeakers([
      { channel: 13, name: "  Meja Packing " },
      { channel: 2, name: "" },
      { channel: 13, name: "duplikat" },
      { channel: 99, name: "di luar batas" },
      { channel: "x", name: "bukan angka" }
    ])).toEqual([{ channel: 2, name: "Kanal 2" }, { channel: 13, name: "Meja Packing" }]);
    expect(normalizeSpeakers("bukan daftar")).toEqual([]);
  });
});

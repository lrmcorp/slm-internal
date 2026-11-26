import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }));

const { normalizeSpeakers, DEFAULT_SPEAKERS } = await import("@/lib/cctv/speakers");

describe("speaker CCTV untuk pengumuman", () => {
  it("bawaan berisi kanal yang menerima suara saat diuji, kanal 13 untuk pengumuman pesanan", () => {
    expect(DEFAULT_SPEAKERS.map((s) => s.channel)).toEqual([1, 2, 5, 6, 12, 13, 15]);
    expect(DEFAULT_SPEAKERS.find((s) => s.channel === 13)?.name).toContain("pengumuman pesanan");
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

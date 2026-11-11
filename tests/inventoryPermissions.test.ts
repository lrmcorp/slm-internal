import { describe, expect, it } from "vitest";
import { visibleNavLinks } from "@/components/layout/navigation";
import type { Role } from "@/lib/auth/roles";

const inventoryMenu = (role: Role) => visibleNavLinks(role).filter((l) => l.category === "INVENTORY GUDANG & TOKO").map((l) => l.label);

describe("menu inventory per role", () => {
  it("Super Admin melihat semua menu", () => {
    expect(inventoryMenu("OWNER")).toEqual([
      "Stok Gudang & Toko", "Terjual dari Gudang", "Proses Permintaan Gudang", "Permintaan Barang", "Laporan Selisih Gudang", "Barang Keluar", "Mutasi / Kartu Stok", "Transfer Stok", "Barang Masuk", "Stock Opname",
      "Import Opname Excel", "Stock Adjustment", "Master Barang", "Kalkulator Modal", "Lokasi Stok"
    ]);
  });

  it("Admin hanya stok, barang keluar, opname, transfer", () => {
    expect(inventoryMenu("ADMIN")).toEqual(["Stok Gudang & Toko", "Terjual dari Gudang", "Permintaan Barang", "Barang Keluar", "Transfer Stok", "Stock Opname"]);
  });

  it("Manager & Supervisor semua kecuali Master Barang, Gudang & Toko (dan Import)", () => {
    const expected = ["Stok Gudang & Toko", "Terjual dari Gudang", "Mutasi / Kartu Stok", "Transfer Stok", "Barang Masuk", "Stock Opname", "Stock Adjustment"];
    expect(inventoryMenu("MANAGER")).toEqual(["Stok Gudang & Toko", "Terjual dari Gudang", "Permintaan Barang", "Laporan Selisih Gudang", ...expected.slice(2)]);
    // Barang Keluar memuat nota penjualan, jadi hanya untuk role yang boleh melihat penjualan.
    expect(inventoryMenu("SUPERVISOR")).toEqual(["Stok Gudang & Toko", "Terjual dari Gudang", "Proses Permintaan Gudang", "Permintaan Barang", "Laporan Selisih Gudang", "Barang Keluar", ...expected.slice(2)]);
  });

  it("Petugas DO (packing) hanya stok dan mutasi", () => {
    expect(inventoryMenu("DELIVERY_DRIVER")).toEqual(["Stok Gudang & Toko", "Terjual dari Gudang", "Mutasi / Kartu Stok"]);
  });

  it("Gudang: proses permintaan barang, stok, mutasi, transfer; plus DO (merangkap packing)", () => {
    expect(inventoryMenu("GUDANG")).toEqual(["Stok Gudang & Toko", "Terjual dari Gudang", "Proses Permintaan Gudang", "Mutasi / Kartu Stok", "Transfer Stok"]);
    expect(visibleNavLinks("GUDANG").map((l) => l.href)).toContain("/delivery-orders");
  });

  it("Finance dan Viewer tidak melihat inventory", () => {
    expect(inventoryMenu("FINANCE")).toEqual([]);
    expect(inventoryMenu("VIEWER")).toEqual([]);
  });

  it("Admin: menu operasional hanya Riwayat & Draft Penjualan, DO, Tempo; Stock Barang lama sudah digabung", async () => {
    const { visibleNavGroups } = await import("@/components/layout/navigation");
    const ops = visibleNavGroups("ADMIN").find((g) => g.category === "OPERASIONAL & TRANSAKSI")?.links.map((l) => l.label);
    expect(ops).toEqual(["Riwayat Penjualan", "Draft Penjualan", "Delivery Order (DO)", "Tempo & Piutang"]);
    expect(visibleNavLinks("OWNER").some((l) => l.href === "/barang")).toBe(false);
  });
});

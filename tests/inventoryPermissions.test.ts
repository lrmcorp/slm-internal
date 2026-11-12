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

  it("Manager semua kecuali Master Barang, Gudang & Toko (dan Import); Supervisor juga Master Barang", () => {
    const expected = ["Stok Gudang & Toko", "Terjual dari Gudang", "Mutasi / Kartu Stok", "Transfer Stok", "Barang Masuk", "Stock Opname", "Stock Adjustment"];
    expect(inventoryMenu("MANAGER")).toEqual(["Stok Gudang & Toko", "Terjual dari Gudang", "Permintaan Barang", "Laporan Selisih Gudang", ...expected.slice(2)]);
    // Barang Keluar memuat nota penjualan, jadi hanya untuk role yang boleh melihat penjualan.
    expect(inventoryMenu("SUPERVISOR")).toEqual(["Stok Gudang & Toko", "Terjual dari Gudang", "Proses Permintaan Gudang", "Permintaan Barang", "Laporan Selisih Gudang", "Barang Keluar", ...expected.slice(2), "Master Barang", "Kalkulator Modal"]);
  });

  it("Petugas DO (packing) hanya stok dan mutasi", () => {
    expect(inventoryMenu("DELIVERY_DRIVER")).toEqual(["Stok Gudang & Toko", "Terjual dari Gudang", "Mutasi / Kartu Stok"]);
  });

  it("Gudang hanya urusan gudang (tanpa DO); Petugas DO hanya DO", () => {
    expect(inventoryMenu("GUDANG")).toEqual(["Stok Gudang & Toko", "Terjual dari Gudang", "Proses Permintaan Gudang", "Mutasi / Kartu Stok", "Transfer Stok"]);
    expect(visibleNavLinks("GUDANG").map((l) => l.href)).not.toContain("/delivery-orders");
    expect(visibleNavLinks("DELIVERY_DRIVER").map((l) => l.href)).not.toContain("/gudang");
  });

  it("Rangkap role: Petugas DO + Gudang melihat menu keduanya", () => {
    const hrefs = visibleNavLinks({ role: "DELIVERY_DRIVER", extraRoles: ["GUDANG"] }).map((l) => l.href);
    expect(hrefs).toContain("/delivery-orders");
    expect(hrefs).toContain("/gudang");
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

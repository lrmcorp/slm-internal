import { describe, expect, it } from "vitest";
import { visibleNavGroups } from "@/components/layout/navigation";
import { ROLES, type Role } from "@/lib/auth/roles";

const categories = (role: Role) => visibleNavGroups(role).map((g) => g.category);

describe("visibilitas grup menu per role", () => {
  it("Akuntansi & Buku Besar dan Pusat Laporan hanya Super Admin; Finance hanya Bagan Akun", () => {
    for (const role of ROLES) {
      const cats = categories(role);
      expect(cats.includes("AKUNTANSI & BUKU BESAR"), role).toBe(role === "OWNER" || role === "FINANCE");
      expect(cats.includes("PUSAT LAPORAN"), role).toBe(role === "OWNER");
    }
    const financeAccounting = visibleNavGroups("FINANCE").find((g) => g.category === "AKUNTANSI & BUKU BESAR");
    expect(financeAccounting?.links.map((l) => l.href)).toEqual(["/akuntansi/coa"]);
  });

  it("Finance bisa membuka Pengaturan untuk mengelola Rekening", () => {
    const links = visibleNavGroups("FINANCE").flatMap((g) => g.links.map((l) => l.href));
    expect(links).toContain("/settings");
  });

  it("SDM & Personalia dan Sistem & Monitoring terlihat oleh Manager dengan semua menunya", () => {
    const owner = visibleNavGroups("OWNER");
    const manager = visibleNavGroups("MANAGER");
    for (const cat of ["SDM & PERSONALIA", "SISTEM & MONITORING"] as const) {
      expect(manager.find((g) => g.category === cat)?.links.map((l) => l.href)).toEqual(owner.find((g) => g.category === cat)?.links.map((l) => l.href));
    }
  });

  it("Admin dan Petugas DO (packing) tidak melihat Akuntansi, Laporan, SDM, Sistem", () => {
    for (const role of ["ADMIN", "DELIVERY_DRIVER"] as const) {
      const cats = categories(role);
      for (const cat of ["AKUNTANSI & BUKU BESAR", "PUSAT LAPORAN", "SDM & PERSONALIA", "SISTEM & MONITORING"]) expect(cats, role).not.toContain(cat);
    }
  });
});

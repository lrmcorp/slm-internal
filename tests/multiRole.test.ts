import { describe, expect, it } from "vitest";
import { can, hasRole, isPackingRole, primaryRole, rolesLabel, rolesOf } from "@/lib/auth/roles";

describe("rangkap role (role utama + role tambahan)", () => {
  const doAndGudang = { role: "DELIVERY_DRIVER" as const, extraRoles: ["GUDANG" as const] };

  it("hak akses = gabungan role; role utama tetap untuk halaman awal/label", () => {
    expect(can(doAndGudang, "do.process")).toBe(true);
    expect(can(doAndGudang, "gudang.request.process")).toBe(true);
    expect(can(doAndGudang, "penjualan.create")).toBe(false);
    expect(primaryRole(doAndGudang)).toBe("DELIVERY_DRIVER");
    expect(rolesLabel(doAndGudang)).toBe("Petugas DO + Gudang");
  });

  it("Gudang saja tidak bisa DO; Petugas DO saja tidak bisa proses gudang", () => {
    expect(can("GUDANG", "do.process")).toBe(false);
    expect(can("DELIVERY_DRIVER", "gudang.request.process")).toBe(false);
    expect(isPackingRole("GUDANG")).toBe(false);
    expect(isPackingRole({ role: "GUDANG", extraRoles: ["DELIVERY_DRIVER"] })).toBe(true);
  });

  it("role tambahan duplikat/sama dengan role utama diabaikan; teks role tetap didukung", () => {
    expect(rolesOf({ role: "ADMIN", extraRoles: ["ADMIN", "GUDANG", "GUDANG"] })).toEqual(["ADMIN", "GUDANG"]);
    expect(hasRole("OWNER", "OWNER")).toBe(true);
    expect(can("OWNER", "users.manage")).toBe(true);
  });
});

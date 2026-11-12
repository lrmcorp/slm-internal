export const ROLES = ["OWNER", "SUPERVISOR", "ADMIN", "FINANCE", "MANAGER", "DELIVERY_DRIVER", "GUDANG", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export const ALL_PERMISSIONS = [
  "dashboard.view", "penjualan.create", "pengeluaran.view", "pengeluaran.create", "stock.create", "stock.view",
  "penjualan.manage", "pengeluaran.manage", "stock.manage", "stock.adjust",
  "reports.view", "reports.finance_view", "settings.view", "settings.tipe.manage", "settings.rekening.manage",
  "settings.coa.manage", "settings.whatsapp.manage", "settings.profit.manage", "settings.erp_sync.manage", "users.manage", "approval.view", "approval.approve",
  "tempo.view", "tempo.view_due", "tempo.mark_paid", "tempo.cancel", "tempo.write_off", "audit.view", "erp_sync.retry", "rekening.reset",
  "master_data.view", "guide.view", "do.view", "do.process", "do.assign",
  "sdm.view", "sdm.employee.manage", "sdm.kasbon.manage", "sdm.salary.view", "sdm.savings.manage",
  "cashbank.manage", "gudang.request.create", "gudang.request.process", "gudang.report.view", "accounting.view", "accounting.journal.manage", "accounting.coa.manage", "accounting.period.manage", "accounting.rates.manage",
  "purchasing.view", "purchasing.order.manage", "purchasing.invoice.manage", "purchasing.payment.manage",
  // Inventory gudang & toko: satu permission per menu
  "inventory.stock.view", "inventory.movement.view", "inventory.transfer", "inventory.receive",
  "inventory.opname", "inventory.adjust", "inventory.import", "inventory.master", "inventory.location"
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

export const ROLE_COOKIE = "aneka_jaya_role";

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Super Admin",
  SUPERVISOR: "Supervisor",
  ADMIN: "Admin",
  FINANCE: "Finance",
  MANAGER: "Manager",
  DELIVERY_DRIVER: "Petugas DO",
  GUDANG: "Gudang",
  VIEWER: "Viewer"
};

/**
 * Inventory: Super Admin semua menu. Manager & Supervisor semua kecuali Master Barang,
 * Gudang & Toko, dan Import Excel (yang mengubah master barang).
 */
const INVENTORY_MANAGER: Permission[] = [
  "inventory.stock.view", "inventory.movement.view", "inventory.transfer", "inventory.receive", "inventory.opname", "inventory.adjust"
];

/** Akuntansi & Buku Besar, Pusat Laporan, dan Kelola User: hanya Super Admin. */
const OWNER_ONLY = (p: Permission) => p.startsWith("accounting.") || p === "reports.view" || p === "reports.finance_view" || p === "users.manage";

/** SDM & Personalia dan Sistem & Monitoring yang terlihat oleh Manager (dan Supervisor). */
const MANAGER_SDM_SYSTEM: Permission[] = [
  "sdm.view", "sdm.employee.manage", "sdm.savings.manage", "sdm.salary.view",
  "audit.view", "erp_sync.retry", "settings.view", "guide.view"
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: [...ALL_PERMISSIONS],
  // Gaji tetap rahasia dari Supervisor.
  // Master Barang (isi per koli, harga, modal) juga dibuka untuk Supervisor.
  SUPERVISOR: ALL_PERMISSIONS.filter((p) => !OWNER_ONLY(p) && p !== "sdm.salary.view" && !p.startsWith("inventory.")).concat(INVENTORY_MANAGER, "inventory.master"),
  ADMIN: [
    "penjualan.create", "penjualan.manage", "do.view", "do.process", "do.assign",
    // Tempo terbatas: hanya daftar yang jatuh tempo ≤ 3 hari, tanpa total nominal
    "tempo.view_due",
    "inventory.stock.view", "inventory.opname", "inventory.transfer",
    // Sales meminta barang dari gudang.
    "gudang.request.create"
  ],
  FINANCE: [
    "pengeluaran.view", "pengeluaran.create", "tempo.view", "tempo.mark_paid",
    "master_data.view", "guide.view",
    // Akuntan: seluruh fungsi akuntansi (jurnal, buku besar, neraca saldo, kurs, COA, tutup buku, rekonsiliasi,
    // persediaan, aset tetap) dan laporan keuangan (laba rugi, neraca, laporan finance).
    "accounting.view", "accounting.journal.manage", "accounting.coa.manage", "accounting.period.manage", "accounting.rates.manage",
    "reports.finance_view",
    "settings.view", "settings.rekening.manage", "cashbank.manage",
    "sdm.view", "sdm.kasbon.manage", "sdm.salary.view", "sdm.savings.manage",
    "purchasing.view", "purchasing.order.manage", "purchasing.invoice.manage", "purchasing.payment.manage"
  ],
  MANAGER: [
    "pengeluaran.view", "approval.view", "approval.approve",
    // Sama seperti Admin: hanya daftar jatuh tempo hari ini s/d 3 hari ke depan, tanpa rangkuman nominal.
    "tempo.view_due",
    "master_data.view",
    ...MANAGER_SDM_SYSTEM,
    "purchasing.view", "purchasing.order.manage", "purchasing.invoice.manage",
    ...INVENTORY_MANAGER,
    "gudang.request.create", "gudang.report.view"
  ],
  // Petugas DO = tim packing
  DELIVERY_DRIVER: ["do.view", "do.process", "inventory.stock.view", "inventory.movement.view"],
  // Gudang: memproses permintaan barang dari sales. Yang juga packing DO diberi role tambahan Petugas DO.
  GUDANG: ["gudang.request.process", "inventory.stock.view", "inventory.movement.view", "inventory.transfer"],
  VIEWER: []
};

export function parseRole(value?: string | null, fallback: Role = "VIEWER"): Role {
  if (!value || typeof value !== "string") return fallback;
  const upper = value.trim().toUpperCase() as Role;
  return ROLES.includes(upper) ? upper : fallback;
}

export function roleLabel(role: Role) {
  return ROLE_LABEL[role];
}

/** Role utama + role tambahan seorang user (rangkap jabatan). */
export type RoleSubject = Role | { role: Role; extraRoles?: readonly Role[] | null };

/** Semua role milik subject, role utama di depan, tanpa duplikat. */
export function rolesOf(subject: RoleSubject): Role[] {
  if (typeof subject === "string") return [subject];
  const extras = (subject.extraRoles ?? []).filter((r) => r !== subject.role && ROLES.includes(r));
  return [subject.role, ...Array.from(new Set(extras))];
}

/** Role utama (untuk halaman awal, label, dan aturan khusus Super Admin). */
export function primaryRole(subject: RoleSubject): Role {
  return typeof subject === "string" ? subject : subject.role;
}

/** true bila user memegang role ini, sebagai role utama atau tambahan. */
export function hasRole(subject: RoleSubject, role: Role) {
  return rolesOf(subject).includes(role);
}

/** Boleh bila salah satu role user punya permission ini. */
export function can(subject: RoleSubject, permission: Permission) {
  return rolesOf(subject).some((role) => ROLE_PERMISSIONS[role]?.includes(permission) ?? false);
}

export function landingPageForRole(role: Role) {
  if (role === "OWNER" || role === "SUPERVISOR") return "/dashboard";
  if (role === "ADMIN") return "/penjualan/input";
  if (role === "FINANCE") return "/tempo";
  if (role === "MANAGER") return "/approval";
  if (role === "DELIVERY_DRIVER") return "/delivery-orders";
  if (role === "GUDANG") return "/gudang";
  return "/no-access";
}

/**
 * Siapa yang boleh menambah/ganti/hapus FOTO barang. Pengelola Master Barang, ditambah Admin (Sales)
 * untuk sementara atas permintaan pemilik (8 Nov 2026). Hanya foto; hak Master Barang lain tidak berubah.
 */
export function canEditProductPhoto(role: RoleSubject) {
  return can(role, "inventory.master") || hasRole(role, "ADMIN");
}

/** Petugas packing DO: punya role Petugas DO (utama atau tambahan). */
export function isPackingRole(subject: RoleSubject | string | undefined | null) {
  if (!subject) return false;
  if (typeof subject === "string") return subject === "DELIVERY_DRIVER";
  return hasRole(subject, "DELIVERY_DRIVER");
}

/** Label semua role, mis. "Petugas DO + Gudang". */
export function rolesLabel(subject: RoleSubject) {
  return rolesOf(subject).map((r) => ROLE_LABEL[r]).join(" + ");
}

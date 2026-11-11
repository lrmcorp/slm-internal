import { can, type RoleSubject } from "./roles";

export function canUploadAttachment(role: RoleSubject) {
  return can(role, "penjualan.create") || can(role, "pengeluaran.create") || can(role, "tempo.mark_paid") || can(role, "do.process");
}

export function canListProducts(role: RoleSubject) {
  return can(role, "stock.view") || can(role, "penjualan.create");
}

export function canListStocks(role: RoleSubject) {
  return can(role, "stock.view") || can(role, "penjualan.create");
}

export function canViewMasterData(role: RoleSubject) {
  return can(role, "master_data.view") || can(role, "penjualan.create");
}

export function canListRekening(role: RoleSubject) {
  return can(role, "penjualan.create") || can(role, "pengeluaran.create") || can(role, "tempo.mark_paid") || canViewMasterData(role);
}

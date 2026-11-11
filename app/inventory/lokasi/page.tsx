import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { LocationManager } from "@/components/inventory/LocationManager";
import { InventoryHeader } from "@/components/inventory/ui";
import { can, primaryRole } from "@/lib/auth/roles";
import { getCurrentRole } from "@/lib/auth/session";
import { listLocations } from "@/lib/inventory/service";

export const dynamic = "force-dynamic";

export default async function LokasiPage() {
  const access = await getCurrentRole();
  const role = primaryRole(access);
  if (!can(access, "inventory.location")) redirect("/no-access");
  const locations = await listLocations({ includeInactive: true });
  return (
    <AppShell>
      <InventoryHeader title="Lokasi Stok" description="Semua gudang dan toko tempat stok disimpan. Tandai satu lokasi sebagai default untuk penjualan dan barang masuk." />
      <LocationManager locations={locations} canManage={can(access, "inventory.location")} />
    </AppShell>
  );
}

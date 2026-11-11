import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { ErpSyncSettingsForm } from "@/components/settings/ErpSyncSettingsForm";
import { can, primaryRole } from "@/lib/auth/roles";
import { getCurrentRole } from "@/lib/auth/session";
import { getErpSyncSetting } from "@/lib/settings/erpSync";

export const dynamic = "force-dynamic";

export default async function ErpSyncSettingsPage() {
  const access = await getCurrentRole();
  const role = primaryRole(access);
  if (!can(access, "settings.erp_sync.manage")) redirect("/settings");
  const setting = await getErpSyncSetting();

  return (
    <AppShell>
      <div className="mb-7">
        <h2 className="aj-page-title text-3xl font-bold">Integrasi &amp; ERP Sync</h2>
        <p className="mt-2 text-sm text-slate-600">Kelola koneksi sinkronisasi transaksi ke Aneka Jaya ERP, mode integrasi inbound MJ, dan otomasi sinkronisasi ulang.</p>
      </div>
      <ErpSyncSettingsForm initialSetting={setting} />
    </AppShell>
  );
}

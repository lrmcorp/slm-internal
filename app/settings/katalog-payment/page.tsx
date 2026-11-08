import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { KatalogPaymentForm } from "@/components/settings/KatalogPaymentForm";
import { can } from "@/lib/auth/roles";
import { getCurrentRole } from "@/lib/auth/session";
import { getKatalogPaymentSetting } from "@/lib/settings/katalogPayment";

export const dynamic = "force-dynamic";

export default async function KatalogPaymentSettingsPage() {
  if (!can(await getCurrentRole(), "settings.rekening.manage")) redirect("/settings");
  const setting = await getKatalogPaymentSetting();
  return (
    <AppShell>
      <div className="mb-7">
        <h2 className="aj-page-title text-3xl font-bold">Rekening Katalog Online</h2>
        <p className="mt-2 text-sm text-slate-600">Rekening tujuan transfer untuk pesanan dari mjkatalog.xyz.</p>
      </div>
      <KatalogPaymentForm initial={setting} />
    </AppShell>
  );
}

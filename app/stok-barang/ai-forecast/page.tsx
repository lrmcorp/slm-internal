import { primaryRole } from "@/lib/auth/roles";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { getCurrentRole } from "@/lib/auth/session";
import { getInventoryAiForecast } from "@/lib/ai/inventoryForecast";
import { AiInventoryForecastView } from "@/components/stocks/AiInventoryForecastView";

export const dynamic = "force-dynamic";

export default async function AiInventoryForecastPage() {
  const access = await getCurrentRole();
  const role = primaryRole(access);
  if (role !== "OWNER") {
    redirect("/stok-barang");
  }

  const forecastData = await getInventoryAiForecast();

  return (
    <AppShell>
      <AiInventoryForecastView initialData={forecastData} />
    </AppShell>
  );
}

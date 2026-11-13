import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import { RoleSelector } from "@/components/settings/RoleSelector";
import { isDemoRoleSelectorEnabled } from "@/lib/auth/demoUi";
import { getCurrentRole } from "@/lib/auth/session";
import { can, roleLabel, primaryRole } from "@/lib/auth/roles";
import { getWhatsappProviderStatus } from "@/lib/whatsapp/whatsappClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const access = await getCurrentRole();
  const role = primaryRole(access);
  if (!can(access, "settings.view")) redirect("/no-access");
  const mode =
    process.env.NEXT_PUBLIC_APP_MODE === "production"
      ? "Produksi"
      : "Development";
  const whatsappStatus = getWhatsappProviderStatus();
  const showRoleSelector = isDemoRoleSelectorEnabled();
  const cards = [
    can(access, "settings.tipe.manage")
      ? {
          href: "/settings/tipe",
          title: "Tipe Pembukuan",
          description: "Kelola tipe transaksi (AJ, W, Online, …)",
          tone: "emerald",
        }
      : null,
    can(access, "settings.rekening.manage")
      ? {
          href: "/settings/rekening",
          title: "Rekening",
          description: "Kelola rekening bank / kas per tipe",
          tone: "emerald",
        }
      : null,
    can(access, "settings.rekening.manage")
      ? {
          href: "/settings/katalog-payment",
          title: "Rekening Katalog Online",
          description: "Rekening tujuan transfer pesanan katalog.lrmslm.com",
          tone: "emerald",
        }
      : null,
    can(access, "settings.profit.manage")
      ? {
          href: "/settings/profit-slm",
          title: "Profit Operasional",
          description: "Atur persentase Gross Profit dashboard operasional",
          tone: "emerald",
        }
      : null,
    can(access, "settings.erp_sync.manage")
      ? {
          href: "/settings/erp-sync",
          title: "Integrasi & ERP Sync",
          description: "Atur koneksi transaksi Aneka Jaya ERP, mode MJ, dan stok",
          tone: "emerald",
        }
      : null,
    can(access, "users.manage")
      ? {
          href: "/settings/users",
          title: "Users",
          description: "Kelola login internal dan role database",
          tone: "slate",
        }
      : null,
    can(access, "settings.whatsapp.manage")
      ? {
          href: "/settings/whatsapp",
          title: "WhatsApp",
          description: "Konfigurasi provider dan nomor tujuan",
          tone: "emerald",
        }
      : null,
    can(access, "tempo.view")
      ? {
          href: "/tempo",
          title: "Tempo",
          description: "Kelola piutang tempo pelanggan",
          tone: "emerald",
        }
      : null,
    can(access, "audit.view")
      ? {
          href: "/audit-trail",
          title: "Audit Trail",
          description: "Lihat riwayat perubahan data",
          tone: "slate",
        }
      : null,
  ].filter(Boolean) as Array<{
    href: string;
    title: string;
    description: string;
    tone: "emerald" | "amber" | "slate";
  }>;

  return (
    <AppShell>
      <div className="mb-7">
        <h2 className="aj-page-title text-3xl font-bold">Pengaturan</h2>
        <p className="mt-2 text-sm text-slate-600">
          Konfigurasi aplikasi, role, rekening, approval, tempo, dan WhatsApp.
        </p>
      </div>
      <section className="aj-surface max-w-2xl p-5 sm:p-6">
        <dl className="divide-y divide-slate-100 text-sm">
          <Row label="Mode aplikasi" value={mode} />
          <Row
            label="ERP API"
            value={
              process.env.ANIKA_ERP_API_BASE_URL
                ? "Dikonfigurasi di server"
                : "Belum dikonfigurasi"
            }
          />
          <Row
            label="WhatsApp provider"
            value={whatsappStatus.provider || "Belum dikonfigurasi"}
          />
          <Row label="Peran aktif" value={roleLabel(role)} />
        </dl>
        <p className="mt-5 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          Token ERP dan WhatsApp tidak pernah ditampilkan di halaman ini. Semua
          integrasi berjalan server-side.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {cards.map((card) => (
            <SettingsCard key={card.href} {...card} />
          ))}
        </div>
      </section>
      {showRoleSelector && <RoleSelector currentRole={role} />}
    </AppShell>
  );
}

function SettingsCard({
  href,
  title,
  description,
  tone,
}: {
  href: string;
  title: string;
  description: string;
  tone: "emerald" | "amber" | "slate";
}) {
  const hover = {
    emerald: "hover:border-brand-400 hover:bg-brand-50",
    amber: "hover:border-amber-400 hover:bg-amber-50",
    slate: "hover:border-slate-400 hover:bg-slate-50",
  }[tone];
  return (
    <Link
      className={`flex items-center gap-3 rounded-xl border border-slate-200 p-4 transition ${hover}`}
      href={href}
    >
      <div>
        <p className="font-semibold text-slate-800">{title}</p>
        <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      </div>
    </Link>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-6 py-3">
      <dt className="font-medium text-slate-600">{label}</dt>
      <dd className="text-right text-slate-900">{value}</dd>
    </div>
  );
}

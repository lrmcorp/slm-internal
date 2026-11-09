import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { getCurrentUser } from "@/lib/auth/session";
import { roleLabel } from "@/lib/auth/roles";
import { getUserProfile } from "@/lib/users/profile";
import { PushNotificationToggle } from "@/components/push/PushNotificationToggle";
import { PUSH_AUDIENCE, pushConfig } from "@/lib/push/config";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (user.id === "unauthenticated") redirect("/login");
  const profile = await getUserProfile(user);
  const push = pushConfig();
  const topics = [
    (PUSH_AUDIENCE.newSale as readonly string[]).includes(user.role) ? "Transaksi baru di Riwayat Penjualan" : null,
    (PUSH_AUDIENCE.lowStock as readonly string[]).includes(user.role) ? "Barang menyentuh stok minimum" : null,
    (PUSH_AUDIENCE.tempoDue as readonly string[]).includes(user.role) ? "Tempo jatuh tempo (setiap pagi)" : null,
  ].filter((topic): topic is string => Boolean(topic));

  return (
    <AppShell>
      <div className="mb-7">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.13em] text-brand-600">Akun</p>
        <h2 className="aj-page-title text-3xl font-bold">Profil</h2>
        <p className="mt-2 text-sm text-slate-600">Identitas akun yang tersinkronisasi dari Anika ERP.</p>
      </div>
      <section className="aj-surface max-w-2xl overflow-hidden">
        <dl className="divide-y divide-neutral-200">
          <ProfileRow label="Nama" value={profile.name} />
          <ProfileRow label="Email" value={profile.email || "-"} />
          <ProfileRow label="Role aplikasi" value={roleLabel(profile.role)} />
          <ProfileRow label="ID eksternal" value={profile.id} />
          <ProfileRow label="Login terakhir" value={profile.lastLoginAt ? new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(profile.lastLoginAt) : "-"} />
        </dl>
      </section>
      {push.enabled && topics.length > 0 && (
        <section className="aj-surface mt-5 max-w-2xl overflow-hidden">
          <PushNotificationToggle publicKey={push.publicKey} topics={topics} />
        </section>
      )}
      {!push.enabled && user.role === "OWNER" && (
        <section className="aj-surface mt-5 max-w-2xl px-5 py-4 sm:px-6">
          <p className="text-sm font-semibold text-neutral-900">Notifikasi di perangkat ini</p>
          <p className="mt-1 text-sm text-neutral-600">
            Belum aktif di server: kunci notifikasi (VAPID_PUBLIC_KEY dan VAPID_PRIVATE_KEY) belum diisi di pengaturan server aplikasi ini. Setelah diisi dan aplikasi dijalankan ulang, tombol Aktifkan notifikasi muncul di sini.
          </p>
        </section>
      )}
    </AppShell>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 px-5 py-4 sm:grid-cols-[11rem_1fr] sm:px-6"><dt className="text-sm font-medium text-neutral-500">{label}</dt><dd className="break-words text-sm font-semibold text-neutral-900">{value}</dd></div>;
}

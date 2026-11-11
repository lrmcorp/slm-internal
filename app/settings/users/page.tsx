import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { UserManager, type UserRow } from "@/components/settings/UserManager";
import { can, primaryRole } from "@/lib/auth/roles";
import { getCurrentRole } from "@/lib/auth/session";
import { listUsers } from "@/lib/users/store";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const access = await getCurrentRole();
  const role = primaryRole(access);
  if (!can(access, "users.manage")) redirect("/settings");
  const users = await listUsers();
  const rows: UserRow[] = users.map((user) => ({
    id: user.id,
    externalId: user.externalId,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    hasPassword: user.hasPassword,
    lastLoginAt: user.lastLoginAt?.toISOString() || null
  }));
  return (
    <AppShell>
      <div className="mb-7">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.13em] text-brand-600">Super Admin</p>
        <h2 className="aj-page-title text-3xl font-bold">Users</h2>
        <p className="mt-2 text-sm text-slate-600">Kelola user login internal, role database, dan status akses aplikasi.</p>
      </div>
      <UserManager users={rows} />
    </AppShell>
  );
}

import type { ReactNode } from "react";
import { Header } from "./Header";
import { MobileNavigationDrawer } from "./MobileNavigationDrawer";
import { Sidebar } from "./Sidebar";
import { SectionTabs } from "./SectionTabs";
import { getCurrentUser } from "@/lib/auth/session";
import { shouldShowDemoLogout } from "@/lib/auth/demoUi";
import { resolveAuthProvider } from "@/lib/auth/request";
import { getUserProfile } from "@/lib/users/profile";
import { getNavBadges } from "@/lib/layout/navBadges";

export async function AppShell({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const [profile, badges] = await Promise.all([getUserProfile(user), getNavBadges(user)]);
  const provider = resolveAuthProvider();
  return (
    <div className="min-h-screen lg:flex">
      <MobileNavigationDrawer role={{ role: user.role, extraRoles: user.extraRoles ?? [] }} userName={profile.name} badges={badges} />
      <Sidebar role={{ role: user.role, extraRoles: user.extraRoles ?? [] }} badges={badges} />
      <main className="min-w-0 flex-1 p-5 sm:p-8 lg:p-10">
        <Header user={profile} showDemoLogout={shouldShowDemoLogout()} showLogout={provider === "local_credentials" || provider === "anika_erp"} />
        <SectionTabs role={{ role: user.role, extraRoles: user.extraRoles ?? [] }} />
        {children}
      </main>
    </div>
  );
}

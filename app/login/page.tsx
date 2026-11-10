import { redirect } from "next/navigation";
import { LoginPageShell } from "@/components/auth/LoginPageShell";
import { authenticatedLoginTarget, shouldRedirectAuthenticatedLogin } from "@/lib/auth/login";
import { getCurrentUser } from "@/lib/auth/session";
import { outsideHoursMessage } from "@/lib/auth/localCredentials";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ jam?: string }> }) {
  const user = await getCurrentUser();
  if (user.id !== "unauthenticated" && shouldRedirectAuthenticatedLogin(user.role)) redirect(authenticatedLoginTarget(user.role));
  const params = (await searchParams) ?? {};
  return <LoginPageShell notice={params.jam ? outsideHoursMessage() : undefined} />;
}

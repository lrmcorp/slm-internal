import { primaryRole } from "@/lib/auth/roles";
import "server-only";
import { redirect } from "next/navigation";
import { can, type Permission, type Role } from "./roles";
import { getCurrentRole } from "./session";

type PermissionInput = Permission | Permission[];

export async function requirePermission(permission: PermissionInput, fallback = "/no-access"): Promise<Role> {
  const access = await getCurrentRole();
  const role = primaryRole(access);
  const allowed = Array.isArray(permission)
    ? permission.some((item) => can(access, item))
    : can(access, permission);
  if (!allowed) redirect(fallback);
  return role;
}

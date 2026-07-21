import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";

/**
 * Fine-grained capability keys — the app-layer mirror of the `public.permissions`
 * catalogue seeded in `20260718230000_rbac_permissions.sql`. This ADDITIVE layer
 * sits on top of the existing `profiles.role` model: `admin` (super admin) holds
 * every key implicitly; any other member holds only what the super admin granted
 * them directly or via their assigned custom role.
 *
 * Keep this union in sync with the migration's seed + the DB `private.has_permission`
 * helper. The database is the source of truth (RLS enforces it); this helper is the
 * page-guard / server-action mirror so a route can gate before hitting the DB.
 */
export const PERMISSION_KEYS = [
  "partners.labs.manage",
  "partners.pharmacies.manage",
  "partners.facilities.manage",
  "partners.specialists.manage",
  "partners.home_visit.manage",
  "partners.logistics.manage",
  "orgs.hmo.manage",
  "orgs.corporate.manage",
  "orgs.manage",
  "users.provision",
  "users.roles.assign",
  "users.permissions.grant",
  "roles.manage",
  "clinical_staff.manage",
  "protocols.manage",
  "service_regions.manage",
  "subscriptions.manage",
  "commissions.view",
  "broadcasts.send",
  "conditions.manage",
  "health_education.manage",
  "logistics.orders.manage",
  "analytics.view",
  "members.activity.view",
  "integrations.manage",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export type CallerPermissions = {
  /** True for the super admin (`admin` role) — holds every capability. */
  isSuperAdmin: boolean;
  /** Explicit keys held via direct grants + assigned custom role (empty for a super admin — use isSuperAdmin). */
  keys: Set<string>;
};

/**
 * The signed-in caller's capabilities, computed under their RLS-scoped session
 * (a member may read their own active grants + any custom-role bundle; both
 * policies allow it). Returns isSuperAdmin=true for `admin` without a DB round-trip
 * for the key set, since admin short-circuits every check.
 */
export async function getCallerPermissions(): Promise<CallerPermissions> {
  const profile = await getCurrentProfile();
  if (!profile) return { isSuperAdmin: false, keys: new Set() };
  if (profile.role === "admin") return { isSuperAdmin: true, keys: new Set() };

  const supabase = await createClient();
  const keys = new Set<string>();

  const { data: grants } = await supabase
    .from("user_permission_grants")
    .select("permission_key")
    .eq("profile_id", profile.id)
    .is("revoked_at", null);
  grants?.forEach((g) => keys.add(g.permission_key));

  if (profile.custom_role_id) {
    const { data: rolePerms } = await supabase
      .from("role_permissions")
      .select("permission_key")
      .eq("custom_role_id", profile.custom_role_id);
    rolePerms?.forEach((r) => keys.add(r.permission_key));
  }

  return { isSuperAdmin: false, keys };
}

/**
 * True when the caller may perform `perm`. Mirrors `private.has_permission` —
 * the DB RLS gate is the real enforcement; this is the page-guard / server-action
 * check so we can redirect or 403 cleanly before attempting a write.
 */
export async function hasPermission(perm: PermissionKey): Promise<boolean> {
  const { isSuperAdmin, keys } = await getCallerPermissions();
  return isSuperAdmin || keys.has(perm);
}

/** True when the caller holds ANY of `perms` (super admin always passes). */
export async function hasAnyPermission(...perms: PermissionKey[]): Promise<boolean> {
  const { isSuperAdmin, keys } = await getCallerPermissions();
  return isSuperAdmin || perms.some((p) => keys.has(p));
}

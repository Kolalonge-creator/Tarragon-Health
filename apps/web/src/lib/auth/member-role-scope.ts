/**
 * Who may assign which role to whom, as the UI should show it.
 *
 * This mirrors the scope rule inside the `public.set_member_role` RPC
 * (20261005154850_set_member_role_scoped_rpc.sql). The RPC is the real
 * enforcement: it self-authorizes and is reachable directly, so nothing here
 * is a security boundary. This exists so the members screen does not offer a
 * role the database will refuse, and says why when it hides one.
 *
 * Keep it in step with the RPC:
 *  - A Super Admin can assign any role to any member.
 *  - Anyone else holding users.roles.assign may only assign clinician or
 *    care_coordinator, on a member of their OWN organisation, never on a
 *    Super Admin or a null-org account.
 *  - Nobody is offered their own account here. The RPC refuses self-assignment.
 */

export const DELEGATE_ASSIGNABLE_ROLES = ["clinician", "care_coordinator"] as const;

export type RoleScopeRefusal =
  | "self"
  | "super_admin_target"
  | "no_organisation"
  | "other_organisation";

export type RoleScopeDecision =
  | { allowed: true }
  | { allowed: false; reason: RoleScopeRefusal };

export type RoleScopeCaller = {
  id: string;
  isSuperAdmin: boolean;
  organisationId: string | null;
};

export type RoleScopeTarget = {
  id: string;
  role: string;
  organisation_id: string | null;
};

export function roleScope(
  caller: RoleScopeCaller,
  target: RoleScopeTarget
): RoleScopeDecision {
  if (target.id === caller.id) return { allowed: false, reason: "self" };
  if (caller.isSuperAdmin) return { allowed: true };

  if (target.role === "admin") return { allowed: false, reason: "super_admin_target" };
  if (target.organisation_id === null) return { allowed: false, reason: "no_organisation" };
  if (caller.organisationId === null || target.organisation_id !== caller.organisationId) {
    return { allowed: false, reason: "other_organisation" };
  }
  return { allowed: true };
}

export const ROLE_SCOPE_HINT: Record<RoleScopeRefusal, string | null> = {
  self: null,
  super_admin_target: "Only a Super Admin can change a Super Admin's role.",
  no_organisation:
    "Only a Super Admin can change the role of platform-level or partner logins.",
  other_organisation: "You can only change the role of members in your own organisation.",
};

/** The roles the form should offer this caller for assignment (the RPC enforces the same set). */
export function assignableRoles<R extends string>(
  caller: Pick<RoleScopeCaller, "isSuperAdmin">,
  allRoles: readonly R[]
): R[] {
  if (caller.isSuperAdmin) return [...allRoles];
  return allRoles.filter((r) => (DELEGATE_ASSIGNABLE_ROLES as readonly string[]).includes(r));
}

/**
 * Who may create which login, and where.
 *
 * `provisionMemberAction` creates the auth user through the service-role admin
 * API and the `handle_new_user` trigger then turns the metadata `role` /
 * `organisation_id` into the profile. The service role bypasses every database
 * policy, so the database cannot tell who is asking: this check IS the
 * enforcement. It runs on the server before anything is created, and the form
 * uses the same rule only to avoid offering choices the server will refuse.
 *
 * `users.provision` is delegable. Without a rule, anyone holding it could create
 * a Super Admin login (probed 2026-10-04: metadata `role: admin` becomes an
 * admin profile), or a login in any organisation.
 *
 * The rule:
 *  - A Super Admin (active, profile role 'admin') can create any role, in any
 *    organisation or none. Partner and platform-level roles have no
 *    organisation, so only a Super Admin can create those.
 *  - Anyone else holding users.provision may create only a clinician or care
 *    coordinator, and only in their OWN organisation.
 *
 * Why those two roles only. The others either confer authority beyond one
 * organisation or are not org-scoped at all. `finance` and `analyst` pass the
 * database's role helpers (is_finance, is_analyst) on role alone, with no
 * organisation check, so provisioning one "in your own organisation" would still
 * grant platform-wide access. `admin` is the platform. Partner roles (pharmacist,
 * lab_partner, lab_liaison) and institution admins (corporate_admin, hmo_admin)
 * belong to other organisations or none. Add a role here only after checking its
 * database helpers are organisation-scoped.
 */

export const DELEGATE_PROVISIONABLE_ROLES = ["clinician", "care_coordinator"] as const;

export type ProvisionScopeCaller = {
  /** True when the caller is an active Super Admin (profile role 'admin'). */
  isSuperAdmin: boolean;
  /** The caller's organisation, null for Super Admin and partner-role logins. */
  organisationId: string | null;
};

export type ProvisionScopeInput = {
  role: string;
  organisationId: string | null | undefined;
};

export type ProvisionScopeRefusal =
  | "super_admin_role"
  | "role_not_allowed"
  | "no_organisation"
  | "other_organisation";

export type ProvisionScopeDecision =
  | { allowed: true }
  | { allowed: false; reason: ProvisionScopeRefusal; message: string };

export function provisionScope(
  caller: ProvisionScopeCaller,
  input: ProvisionScopeInput
): ProvisionScopeDecision {
  if (caller.isSuperAdmin) return { allowed: true };

  if (input.role === "admin") {
    return {
      allowed: false,
      reason: "super_admin_role",
      message: "Only a Super Admin can create a Super Admin login.",
    };
  }
  if (!(DELEGATE_PROVISIONABLE_ROLES as readonly string[]).includes(input.role)) {
    return {
      allowed: false,
      reason: "role_not_allowed",
      message: "Only a Super Admin can create this kind of login.",
    };
  }
  if (!input.organisationId) {
    return {
      allowed: false,
      reason: "no_organisation",
      message: "Choose your organisation. A login created here must belong to it.",
    };
  }
  if (caller.organisationId === null || input.organisationId !== caller.organisationId) {
    return {
      allowed: false,
      reason: "other_organisation",
      message: "You can only create logins in your own organisation.",
    };
  }
  return { allowed: true };
}

/** The roles the form should offer this caller (the server enforces the same set). */
export function provisionableRoles<R extends string>(
  caller: ProvisionScopeCaller,
  allRoles: readonly R[]
): R[] {
  if (caller.isSuperAdmin) return [...allRoles];
  return allRoles.filter((r) => (DELEGATE_PROVISIONABLE_ROLES as readonly string[]).includes(r));
}

/** The organisations the form should offer this caller. */
export function provisionableOrganisations<O extends { id: string }>(
  caller: ProvisionScopeCaller,
  organisations: readonly O[]
): O[] {
  if (caller.isSuperAdmin) return [...organisations];
  if (caller.organisationId === null) return [];
  return organisations.filter((o) => o.id === caller.organisationId);
}

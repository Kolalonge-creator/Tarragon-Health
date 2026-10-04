/**
 * Who may suspend or reinstate whom, as the UI should show it.
 *
 * This mirrors the scope rule inside the `public.set_member_active` RPC
 * (20261004194229_set_member_active_scope_and_audit.sql). The RPC is the real
 * enforcement: it self-authorizes and is reachable directly, so nothing here is a
 * security boundary. This exists so the members screen does not offer a button
 * that the database will refuse, and says why when it hides one.
 *
 * Keep it in step with the RPC:
 *  - A Super Admin (role = 'admin', active) can act on any member.
 *  - Anyone else holding users.suspend may only act on members of their OWN
 *    organisation, and never on a Super Admin or on a null-organisation account
 *    (those are Super Admin and partner-role logins).
 *  - Nobody is offered their own account here. The RPC refuses self-suspension;
 *    reinstating yourself is meaningless because an inactive login cannot reach
 *    this screen.
 */

export type SuspendScopeRefusal =
  | "self"
  | "super_admin_target"
  | "no_organisation"
  | "other_organisation";

export type SuspendScopeDecision =
  | { allowed: true }
  | { allowed: false; reason: SuspendScopeRefusal };

export type SuspendScopeCaller = {
  /** The signed-in member's own profile id. */
  id: string;
  /** True when the caller is an active Super Admin (profile role 'admin'). */
  isSuperAdmin: boolean;
  /** The caller's organisation, null for Super Admin and partner-role logins. */
  organisationId: string | null;
};

export type SuspendScopeTarget = {
  id: string;
  role: string;
  organisation_id: string | null;
};

export function suspendScope(
  caller: SuspendScopeCaller,
  target: SuspendScopeTarget
): SuspendScopeDecision {
  if (target.id === caller.id) return { allowed: false, reason: "self" };
  if (caller.isSuperAdmin) return { allowed: true };

  if (target.role === "admin") return { allowed: false, reason: "super_admin_target" };
  if (target.organisation_id === null) return { allowed: false, reason: "no_organisation" };
  if (caller.organisationId === null || target.organisation_id !== caller.organisationId) {
    return { allowed: false, reason: "other_organisation" };
  }
  return { allowed: true };
}

/**
 * Short explanation shown where the button is hidden. `self` has none: hiding
 * the control on your own row needs no explaining. Wording follows the RPC's own
 * refusal messages.
 */
export const SUSPEND_SCOPE_HINT: Record<SuspendScopeRefusal, string | null> = {
  self: null,
  super_admin_target: "Only a Super Admin can suspend or reinstate a Super Admin.",
  no_organisation:
    "Only a Super Admin can suspend or reinstate partner and platform-level logins.",
  other_organisation: "You can only suspend or reinstate members of your own organisation.",
};

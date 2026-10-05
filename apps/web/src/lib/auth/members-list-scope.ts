/**
 * What the Members & access page may show the person looking at it.
 *
 * The page loads with the service role so it can show auth emails (which live in
 * auth.users, not profiles). The service role bypasses row-level security, so the
 * page itself has to decide what the caller sees, and until now it showed every
 * non-patient member of every organisation, with emails, to anyone holding any
 * user-administration permission.
 *
 * It matches the scope the actions already enforce (see member-suspend-scope.ts
 * and member-provision-scope.ts):
 *  - A Super Admin sees everyone, as before.
 *  - Anyone else sees only the non-admin members of their OWN organisation. They
 *    are never shown a Super Admin or a null-organisation (partner / platform-
 *    level) login, because they cannot act on those.
 *  - A caller with no organisation of their own sees no members.
 */

export type MembersListCaller = {
  /** True when the caller is an active Super Admin (profile role 'admin'). */
  isSuperAdmin: boolean;
  /** The caller's organisation, null for Super Admin and partner-role logins. */
  organisationId: string | null;
};

export type MembersListScope =
  | { kind: "all" }
  | { kind: "organisation"; organisationId: string }
  | { kind: "none" };

export function membersListScope(caller: MembersListCaller): MembersListScope {
  if (caller.isSuperAdmin) return { kind: "all" };
  if (caller.organisationId === null) return { kind: "none" };
  return { kind: "organisation", organisationId: caller.organisationId };
}

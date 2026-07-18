import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { MembersManager } from "./members-manager";

export type MemberRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  phone: string | null;
  organisation_id: string | null;
  organisation_name: string | null;
  custom_role_id: string | null;
  custom_role_name: string | null;
  is_active: boolean;
  grants: { id: string; permission_key: string }[];
};

export type PermissionRow = { key: string; label: string; category: string; description: string | null };
export type CustomRoleRow = { id: string; name: string; description: string | null; base_role: string; permission_keys: string[] };
export type OrgRow = { id: string; name: string; type: string };

/**
 * Super-admin members & access console. Loaded server-side with the service role
 * so it can show auth emails (which live in auth.users, not profiles) alongside
 * each member's role, custom role, and active permission grants. Reachable by the
 * super admin or anyone the super admin has delegated a user-admin capability to.
 */
export default async function MembersPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const { isSuperAdmin, keys } = await getCallerPermissions();
  const canManageUsers =
    isSuperAdmin ||
    keys.has("users.provision") ||
    keys.has("users.roles.assign") ||
    keys.has("users.permissions.grant") ||
    keys.has("roles.manage");
  if (!canManageUsers) redirect("/admin");

  const svc = createServiceRoleClient();

  const [{ data: profiles }, { data: permissions }, { data: customRoles }, { data: grants }, { data: orgs }] =
    await Promise.all([
      svc
        .from("profiles")
        // custom_roles is embedded via the profiles.custom_role_id FK explicitly —
        // custom_roles.created_by also references profiles, so the relationship
        // is ambiguous without the hint (PostgREST PGRST201).
        .select("id, full_name, role, phone, organisation_id, custom_role_id, is_active, organisations(name), custom_roles!profiles_custom_role_id_fkey(name)")
        .order("created_at", { ascending: false }),
      svc.from("permissions").select("key, label, category, description").order("category").order("label"),
      svc.from("custom_roles").select("id, name, description, base_role, role_permissions(permission_key)").order("name"),
      svc.from("user_permission_grants").select("id, profile_id, permission_key").is("revoked_at", null),
      svc.from("organisations").select("id, name, type").order("name"),
    ]);

  // Map auth emails onto profiles (auth.users isn't reachable via PostgREST).
  const emailById = new Map<string, string | null>();
  let page = 1;
  // Small dataset — walk a couple of pages defensively.
  for (;;) {
    const { data: usersPage } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    const list = usersPage?.users ?? [];
    list.forEach((u) => emailById.set(u.id, u.email ?? null));
    if (list.length < 200) break;
    page += 1;
    if (page > 25) break;
  }

  const grantsByMember = new Map<string, { id: string; permission_key: string }[]>();
  (grants ?? []).forEach((g) => {
    const arr = grantsByMember.get(g.profile_id) ?? [];
    arr.push({ id: g.id, permission_key: g.permission_key });
    grantsByMember.set(g.profile_id, arr);
  });

  const members: MemberRow[] = (profiles ?? []).map((p) => {
    const org = p.organisations as { name: string } | null;
    const cr = p.custom_roles as { name: string } | null;
    return {
      id: p.id,
      email: emailById.get(p.id) ?? null,
      full_name: p.full_name,
      role: p.role,
      phone: p.phone,
      organisation_id: p.organisation_id,
      organisation_name: org?.name ?? null,
      custom_role_id: p.custom_role_id,
      custom_role_name: cr?.name ?? null,
      is_active: p.is_active,
      grants: grantsByMember.get(p.id) ?? [],
    };
  });

  const roleRows: CustomRoleRow[] = (customRoles ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    base_role: r.base_role,
    permission_keys: ((r.role_permissions as { permission_key: string }[]) ?? []).map((rp) => rp.permission_key),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Members &amp; access</h1>
        <p className="text-charcoal-ink/60">
          Create logins for employees and partners, assign roles, build custom roles, and delegate
          specific capabilities (e.g. adding a pharmacy, lab, or hospital) to individual members.
          The super admin holds every capability.
        </p>
      </div>
      <MembersManager
        members={members}
        permissions={(permissions ?? []) as PermissionRow[]}
        customRoles={roleRows}
        organisations={(orgs ?? []) as OrgRow[]}
        canProvision={isSuperAdmin || keys.has("users.provision")}
        canAssignRoles={isSuperAdmin || keys.has("users.roles.assign")}
        canGrant={isSuperAdmin || keys.has("users.permissions.grant")}
        canManageRoles={isSuperAdmin || keys.has("roles.manage")}
        canViewActivity={isSuperAdmin || keys.has("members.activity.view")}
      />
    </div>
  );
}

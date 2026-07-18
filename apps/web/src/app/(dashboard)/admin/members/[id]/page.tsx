import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { USER_ROLE_LABELS, type UserRoleValue } from "@/lib/validation/members";

type ActivityCount = { action: string; count: number };
type ActivityEntry = {
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  created_at: string;
  event: unknown;
};
type MemberActivity = {
  total_actions: number;
  last_active: string | null;
  action_counts: ActivityCount[];
  recent: ActivityEntry[];
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Read-only member oversight — the super admin (or a member delegated
 * `members.activity.view`) sees another member's account, effective
 * capabilities, and recent activity from the immutable audit_log. Activity is
 * fetched through the self-gating public.admin_member_activity RPC so the data
 * path is independently authorised even if this page guard were bypassed.
 */
export default async function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const { isSuperAdmin, keys } = await getCallerPermissions();
  if (!isSuperAdmin && !keys.has("members.activity.view")) redirect("/admin");

  const svc = createServiceRoleClient();
  const [{ data: member }, { data: grants }, { data: permissions }] = await Promise.all([
    svc
      .from("profiles")
      // Disambiguate the custom_roles embed to the profiles.custom_role_id FK
      // (custom_roles.created_by also points at profiles → PGRST201 otherwise).
      .select("id, full_name, role, phone, is_active, created_at, organisation_id, custom_role_id, organisations(name), custom_roles!profiles_custom_role_id_fkey(name, base_role, role_permissions(permission_key))")
      .eq("id", id)
      .maybeSingle(),
    svc.from("user_permission_grants").select("permission_key, granted_at").eq("profile_id", id).is("revoked_at", null),
    svc.from("permissions").select("key, label"),
  ]);

  if (!member) notFound();

  // Resolve the member's auth email (auth.users isn't reachable via PostgREST).
  const { data: authUser } = await svc.auth.admin.getUserById(id);
  const email = authUser?.user?.email ?? null;

  const labelByKey = new Map((permissions ?? []).map((p) => [p.key, p.label]));
  const org = member.organisations as { name: string } | null;
  const customRole = member.custom_roles as
    | { name: string; base_role: string; role_permissions: { permission_key: string }[] }
    | null;
  const directGrants = (grants ?? []).map((g) => g.permission_key);
  const bundleKeys = (customRole?.role_permissions ?? []).map((rp) => rp.permission_key);

  // Activity via the self-gating RPC (runs under the caller's session).
  const supabase = await createClient();
  const { data: activityRaw } = await supabase.rpc("admin_member_activity", { p_member: id });
  const activity = (activityRaw as MemberActivity | null) ?? {
    total_actions: 0,
    last_active: null,
    action_counts: [],
    recent: [],
  };

  const isMemberSuperAdmin = member.role === "admin";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/settings/members" className="text-sm text-brand-green hover:underline">
          ← Back to members
        </Link>
        <h1 className="mt-1 font-heading text-2xl font-semibold text-charcoal-ink">
          {member.full_name ?? "(no name)"}
        </h1>
        <p className="text-charcoal-ink/60">{email ?? "—"}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <span className="text-charcoal-ink/50">Role: </span>
            <Badge variant="grey">{USER_ROLE_LABELS[member.role as UserRoleValue] ?? member.role}</Badge>
          </div>
          <div>
            <span className="text-charcoal-ink/50">Custom role: </span>
            {customRole ? <Badge>{customRole.name}</Badge> : <span className="text-charcoal-ink/70">—</span>}
          </div>
          <div>
            <span className="text-charcoal-ink/50">Organisation: </span>
            <span className="text-charcoal-ink/80">{org?.name ?? "—"}</span>
          </div>
          <div>
            <span className="text-charcoal-ink/50">Phone: </span>
            <span className="text-charcoal-ink/80">{member.phone ?? "—"}</span>
          </div>
          <div>
            <span className="text-charcoal-ink/50">Status: </span>
            {member.is_active ? (
              <Badge variant="green">Active</Badge>
            ) : (
              <Badge variant="red">Inactive</Badge>
            )}
          </div>
          <div>
            <span className="text-charcoal-ink/50">Created: </span>
            <span className="text-charcoal-ink/80">{formatDateTime(member.created_at)}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Capabilities</CardTitle>
          <CardDescription>What this member is allowed to do across the platform.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {isMemberSuperAdmin ? (
            <p className="text-charcoal-ink/70">Super Admin — holds every capability on the platform.</p>
          ) : (
            <>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50">
                  From custom role
                </p>
                {bundleKeys.length === 0 ? (
                  <p className="text-charcoal-ink/60">None</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {bundleKeys.map((k) => (
                      <Badge key={k} variant="blue">
                        {labelByKey.get(k) ?? k}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50">
                  Direct grants
                </p>
                {directGrants.length === 0 ? (
                  <p className="text-charcoal-ink/60">None</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {directGrants.map((k) => (
                      <Badge key={k} variant="green">
                        {labelByKey.get(k) ?? k}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>
            {activity.total_actions} recorded action{activity.total_actions === 1 ? "" : "s"} · last active{" "}
            {formatDateTime(activity.last_active)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {activity.action_counts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {activity.action_counts.map((a) => (
                <span
                  key={a.action}
                  className="rounded-full border border-charcoal-ink/15 px-3 py-1 text-xs text-charcoal-ink/70"
                >
                  {a.action} · {a.count}
                </span>
              ))}
            </div>
          )}
          {activity.recent.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No recorded activity yet.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {activity.recent.map((entry, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="text-charcoal-ink">
                    <span className="font-medium">{entry.action}</span>
                    {entry.entity_type && (
                      <span className="text-charcoal-ink/50"> · {entry.entity_type}</span>
                    )}
                  </span>
                  <span className="text-xs text-charcoal-ink/50">{formatDateTime(entry.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

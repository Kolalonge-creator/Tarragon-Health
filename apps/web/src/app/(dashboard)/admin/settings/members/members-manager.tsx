"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { USER_ROLES, USER_ROLE_LABELS, type UserRoleValue } from "@/lib/validation/members";
import type { MemberRow, PermissionRow, CustomRoleRow, OrgRow } from "./page";
import {
  provisionMemberAction,
  setMemberRoleAction,
  grantPermissionAction,
  revokePermissionAction,
  createCustomRoleAction,
  setCustomRolePermissionsAction,
  deleteCustomRoleAction,
  type MemberActionState,
} from "./actions";

type Feedback = { error?: string; message?: string } | null;

function groupByCategory(permissions: PermissionRow[]): Map<string, PermissionRow[]> {
  const map = new Map<string, PermissionRow[]>();
  permissions.forEach((p) => {
    const arr = map.get(p.category) ?? [];
    arr.push(p);
    map.set(p.category, arr);
  });
  return map;
}

export function MembersManager({
  members,
  permissions,
  customRoles,
  organisations,
  canProvision,
  canAssignRoles,
  canGrant,
  canManageRoles,
  canViewActivity,
}: {
  members: MemberRow[];
  permissions: PermissionRow[];
  customRoles: CustomRoleRow[];
  organisations: OrgRow[];
  canProvision: boolean;
  canAssignRoles: boolean;
  canGrant: boolean;
  canManageRoles: boolean;
  canViewActivity: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const grouped = groupByCategory(permissions);

  function run(action: (fd: FormData) => Promise<MemberActionState>, fd: FormData) {
    startTransition(async () => {
      const result = await action(fd);
      setFeedback(result ?? null);
      if (result?.message) router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {feedback?.error && (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-600">{feedback.error}</p>
      )}
      {feedback?.message && (
        <p className="rounded-md bg-brand-green/10 px-4 py-2 text-sm text-deep-forest">{feedback.message}</p>
      )}

      {canProvision && (
        <CreateLoginCard organisations={organisations} pending={pending} onSubmit={(fd) => run((f) => provisionMemberAction(undefined, f), fd)} />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Members &amp; partners</CardTitle>
          <CardDescription>
            {members.length} account{members.length === 1 ? "" : "s"}. Expand a member to change their role
            or delegate specific capabilities. The Super Admin role holds every capability implicitly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {members.map((m) => (
            <MemberItem
              key={m.id}
              member={m}
              permissionsByCategory={grouped}
              customRoles={customRoles}
              canAssignRoles={canAssignRoles}
              canGrant={canGrant}
              canViewActivity={canViewActivity}
              pending={pending}
              run={run}
            />
          ))}
        </CardContent>
      </Card>

      {canManageRoles && (
        <CustomRolesCard
          customRoles={customRoles}
          permissionsByCategory={grouped}
          pending={pending}
          run={run}
        />
      )}
    </div>
  );
}

function CreateLoginCard({
  organisations,
  pending,
  onSubmit,
}: {
  organisations: OrgRow[];
  pending: boolean;
  onSubmit: (fd: FormData) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a login</CardTitle>
        <CardDescription>
          Provision an account for an employee or partner. They sign in with the email + password you set.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(new FormData(e.currentTarget));
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="fullName">Full name</Label>
            <Input id="fullName" name="fullName" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="phone">Phone (E.164, optional)</Label>
            <Input id="phone" name="phone" placeholder="+2348012345678" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="password">Temporary password</Label>
            <Input id="password" name="password" type="text" minLength={8} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="role">Role</Label>
            <Select id="role" name="role" defaultValue="clinician">
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {USER_ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="organisationId">Organisation (optional)</Label>
            <Select id="organisationId" name="organisationId" defaultValue="">
              <option value="">— none —</option>
              {organisations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.type})
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create login"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function MemberItem({
  member,
  permissionsByCategory,
  customRoles,
  canAssignRoles,
  canGrant,
  canViewActivity,
  pending,
  run,
}: {
  member: MemberRow;
  permissionsByCategory: Map<string, PermissionRow[]>;
  customRoles: CustomRoleRow[];
  canAssignRoles: boolean;
  canGrant: boolean;
  canViewActivity: boolean;
  pending: boolean;
  run: (action: (fd: FormData) => Promise<MemberActionState>, fd: FormData) => void;
}) {
  const grantedKeys = new Set(member.grants.map((g) => g.permission_key));
  const isSuperAdmin = member.role === "admin";

  return (
    <details className="rounded-md border border-charcoal-ink/10 px-4 py-3">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-charcoal-ink">{member.full_name ?? "(no name)"}</span>
        <span className="text-charcoal-ink/50">{member.email ?? "—"}</span>
        <Badge variant="grey">{USER_ROLE_LABELS[member.role as UserRoleValue] ?? member.role}</Badge>
        {member.custom_role_name && <Badge>{member.custom_role_name}</Badge>}
        {member.organisation_name && (
          <span className="text-xs text-charcoal-ink/40">· {member.organisation_name}</span>
        )}
        {!member.is_active && <span className="text-xs text-red-600">· inactive</span>}
      </summary>

      <div className="mt-4 space-y-5">
        {canViewActivity && (
          <Link
            href={`/admin/members/${member.id}`}
            className="inline-block text-sm font-medium text-brand-green hover:underline"
          >
            View activity &amp; oversight →
          </Link>
        )}
        {canAssignRoles && (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.set("memberId", member.id);
              run((f) => setMemberRoleAction(undefined, f), fd);
            }}
          >
            <div className="space-y-1">
              <Label>Account role</Label>
              <Select name="role" defaultValue={member.role}>
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {USER_ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Custom role</Label>
              <Select name="customRoleId" defaultValue={member.custom_role_id ?? ""}>
                <option value="">— none —</option>
                {customRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="outline" disabled={pending}>
              Save role
            </Button>
          </form>
        )}

        <div>
          <p className="mb-2 text-sm font-medium text-charcoal-ink">Delegated capabilities</p>
          {isSuperAdmin ? (
            <p className="text-sm text-charcoal-ink/60">
              Super Admin holds every capability — individual grants aren&apos;t needed.
            </p>
          ) : !canGrant ? (
            <p className="text-sm text-charcoal-ink/60">You don&apos;t have permission to change grants.</p>
          ) : (
            <div className="space-y-3">
              {[...permissionsByCategory.entries()].map(([category, perms]) => (
                <div key={category}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50">{category}</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {perms.map((p) => {
                      const granted = grantedKeys.has(p.key);
                      const grant = member.grants.find((g) => g.permission_key === p.key);
                      return (
                        <button
                          key={p.key}
                          type="button"
                          disabled={pending}
                          title={p.description ?? undefined}
                          onClick={() => {
                            const fd = new FormData();
                            fd.set("memberId", member.id);
                            if (granted && grant) {
                              fd.set("grantId", grant.id);
                              run((f) => revokePermissionAction(undefined, f), fd);
                            } else {
                              fd.set("permissionKey", p.key);
                              run((f) => grantPermissionAction(undefined, f), fd);
                            }
                          }}
                          className={
                            granted
                              ? "rounded-full border border-brand-green bg-brand-green/10 px-3 py-1 text-xs font-medium text-deep-forest"
                              : "rounded-full border border-charcoal-ink/20 px-3 py-1 text-xs text-charcoal-ink/70 hover:border-brand-green"
                          }
                        >
                          {granted ? "✓ " : "+ "}
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

function CustomRolesCard({
  customRoles,
  permissionsByCategory,
  pending,
  run,
}: {
  customRoles: CustomRoleRow[];
  permissionsByCategory: Map<string, PermissionRow[]>;
  pending: boolean;
  run: (action: (fd: FormData) => Promise<MemberActionState>, fd: FormData) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Custom roles</CardTitle>
        <CardDescription>
          A custom role is a named bundle of capabilities plus a base account type (for dashboard
          routing). Assign one to a member above to grant the whole bundle at once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="space-y-3 rounded-md border border-charcoal-ink/10 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run((f) => createCustomRoleAction(undefined, f), fd);
            e.currentTarget.reset();
          }}
        >
          <p className="text-sm font-medium text-charcoal-ink">New custom role</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input name="name" placeholder="e.g. Partnerships Manager" required />
            </div>
            <div className="space-y-1">
              <Label>Base role</Label>
              <Select name="baseRole" defaultValue="care_coordinator">
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {USER_ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-1">
              <Label>Description</Label>
              <Input name="description" placeholder="optional" />
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50">
              Capabilities
            </legend>
            {[...permissionsByCategory.entries()].map(([category, perms]) => (
              <div key={category} className="flex flex-wrap gap-3">
                {perms.map((p) => (
                  <label key={p.key} className="flex items-center gap-1 text-xs text-charcoal-ink/80">
                    <input type="checkbox" name="permissionKeys" value={p.key} /> {p.label}
                  </label>
                ))}
              </div>
            ))}
          </fieldset>
          <Button type="submit" disabled={pending}>
            Create role
          </Button>
        </form>

        {customRoles.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No custom roles yet.</p>
        ) : (
          customRoles.map((role) => (
            <details key={role.id} className="rounded-md border border-charcoal-ink/10 px-4 py-3">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-charcoal-ink">{role.name}</span>
                <Badge variant="grey">{USER_ROLE_LABELS[role.base_role as UserRoleValue] ?? role.base_role}</Badge>
                <span className="text-xs text-charcoal-ink/50">· {role.permission_keys.length} capabilities</span>
              </summary>
              <form
                className="mt-3 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  fd.set("roleId", role.id);
                  run((f) => setCustomRolePermissionsAction(undefined, f), fd);
                }}
              >
                {[...permissionsByCategory.entries()].map(([category, perms]) => (
                  <div key={category}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50">{category}</p>
                    <div className="mt-1 flex flex-wrap gap-3">
                      {perms.map((p) => (
                        <label key={p.key} className="flex items-center gap-1 text-xs text-charcoal-ink/80">
                          <input
                            type="checkbox"
                            name="permissionKeys"
                            value={p.key}
                            defaultChecked={role.permission_keys.includes(p.key)}
                          />{" "}
                          {p.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button type="submit" variant="outline" disabled={pending}>
                    Save capabilities
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set("roleId", role.id);
                      run((f) => deleteCustomRoleAction(undefined, f), fd);
                    }}
                  >
                    Delete role
                  </Button>
                </div>
              </form>
            </details>
          ))
        )}
      </CardContent>
    </Card>
  );
}

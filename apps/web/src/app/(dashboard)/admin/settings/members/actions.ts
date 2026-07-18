"use server";

import { revalidatePath } from "next/cache";
import type { Json } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission, type PermissionKey } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { provisionMemberSchema, USER_ROLES } from "@/lib/validation/members";

export type MemberActionState = { error?: string; message?: string } | undefined;

/** Throws unless the caller holds `perm` (super admin passes everything). */
async function requirePermission(perm: PermissionKey) {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in");
  if (!(await hasPermission(perm))) throw new Error("You don't have access to do that");
  return profile;
}

/** Append an immutable audit_log entry (system write — service role). */
async function recordAudit(
  actorId: string,
  organisationId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  event: Json
) {
  const svc = createServiceRoleClient();
  await svc.from("audit_log").insert({
    actor_id: actorId,
    organisation_id: organisationId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    event,
  });
}

/**
 * Create a login for a new member or partner. Uses the service-role auth admin
 * API (there is no RLS-expressible equivalent for creating an auth user); the
 * `handle_new_user` trigger then provisions the public.profiles row from the
 * app_metadata role/org we set here. Gated by `users.provision`.
 */
export async function provisionMemberAction(
  _prev: MemberActionState,
  formData: FormData
): Promise<MemberActionState> {
  const actor = await requirePermission("users.provision");

  const parsed = provisionMemberSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    phone: formData.get("phone"),
    role: formData.get("role"),
    organisationId: formData.get("organisationId"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }
  const input = parsed.data;

  const svc = createServiceRoleClient();
  const { data, error } = await svc.auth.admin.createUser({
    email: input.email,
    password: input.password,
    phone: input.phone,
    email_confirm: true,
    app_metadata: {
      role: input.role,
      organisation_id: input.organisationId ?? null,
    },
    user_metadata: { full_name: input.fullName },
  });
  if (error || !data.user) {
    return { error: error?.message ?? "Could not create the login" };
  }

  await recordAudit(actor.id, actor.organisation_id, "member.provisioned", "profiles", data.user.id, {
    email: input.email,
    role: input.role,
    organisation_id: input.organisationId ?? null,
  });

  revalidatePath("/admin/settings/members");
  return { message: `Login created for ${input.email} (${input.role}).` };
}

/**
 * Change a member's base account role and/or assigned custom role. Runs under
 * the caller's RLS-scoped session (profiles_update already grants admin), gated
 * by `users.roles.assign`.
 */
export async function setMemberRoleAction(
  _prev: MemberActionState,
  formData: FormData
): Promise<MemberActionState> {
  const actor = await requirePermission("users.roles.assign");

  const memberId = String(formData.get("memberId") ?? "");
  const role = String(formData.get("role") ?? "");
  const customRoleRaw = String(formData.get("customRoleId") ?? "");
  const customRoleId = customRoleRaw ? customRoleRaw : null;

  if (!memberId) return { error: "Missing member" };
  if (!USER_ROLES.includes(role as (typeof USER_ROLES)[number])) {
    return { error: "Invalid role" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ role: role as (typeof USER_ROLES)[number], custom_role_id: customRoleId })
    .eq("id", memberId);
  if (error) return { error: error.message };

  await recordAudit(actor.id, actor.organisation_id, "member.role_changed", "profiles", memberId, {
    role,
    custom_role_id: customRoleId,
  });

  revalidatePath("/admin/settings/members");
  return { message: "Role updated." };
}

/** Grant a single capability to a member (additive). Gated by `users.permissions.grant`. */
export async function grantPermissionAction(
  _prev: MemberActionState,
  formData: FormData
): Promise<MemberActionState> {
  const actor = await requirePermission("users.permissions.grant");

  const memberId = String(formData.get("memberId") ?? "");
  const permissionKey = String(formData.get("permissionKey") ?? "");
  if (!memberId || !permissionKey) return { error: "Missing member or permission" };

  const supabase = await createClient();
  // Re-activate a previously-revoked grant if present, else insert a new one.
  const { error } = await supabase.from("user_permission_grants").insert({
    profile_id: memberId,
    permission_key: permissionKey,
    granted_by: actor.id,
  });
  if (error) {
    // Unique violation means an active grant already exists — treat as success.
    if (error.code === "23505") {
      revalidatePath("/admin/settings/members");
      return { message: "Permission already granted." };
    }
    return { error: error.message };
  }

  await recordAudit(actor.id, actor.organisation_id, "permission.granted", "profiles", memberId, {
    permission_key: permissionKey,
  });

  revalidatePath("/admin/settings/members");
  return { message: "Permission granted." };
}

/** Revoke an active grant (sets revoked_at). Gated by `users.permissions.grant`. */
export async function revokePermissionAction(
  _prev: MemberActionState,
  formData: FormData
): Promise<MemberActionState> {
  const actor = await requirePermission("users.permissions.grant");

  const grantId = String(formData.get("grantId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  if (!grantId) return { error: "Missing grant" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_permission_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: actor.id })
    .eq("id", grantId)
    .is("revoked_at", null);
  if (error) return { error: error.message };

  await recordAudit(actor.id, actor.organisation_id, "permission.revoked", "profiles", memberId || null, {
    grant_id: grantId,
  });

  revalidatePath("/admin/settings/members");
  return { message: "Permission revoked." };
}

/** Create a custom role (permission bundle). Gated by `roles.manage`. */
export async function createCustomRoleAction(
  _prev: MemberActionState,
  formData: FormData
): Promise<MemberActionState> {
  const actor = await requirePermission("roles.manage");

  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const baseRole = String(formData.get("baseRole") ?? "");
  const permissionKeys = formData.getAll("permissionKeys").map(String);

  if (!name) return { error: "Role name is required" };
  if (!USER_ROLES.includes(baseRole as (typeof USER_ROLES)[number])) {
    return { error: "Pick a base role" };
  }

  const supabase = await createClient();
  const { data: role, error } = await supabase
    .from("custom_roles")
    .insert({
      name,
      description: description || null,
      base_role: baseRole as (typeof USER_ROLES)[number],
      created_by: actor.id,
    })
    .select("id")
    .single();
  if (error || !role) return { error: error?.message ?? "Could not create the role" };

  if (permissionKeys.length > 0) {
    const { error: permError } = await supabase
      .from("role_permissions")
      .insert(permissionKeys.map((k) => ({ custom_role_id: role.id, permission_key: k })));
    if (permError) return { error: permError.message };
  }

  await recordAudit(actor.id, actor.organisation_id, "custom_role.created", "custom_roles", role.id, {
    name,
    base_role: baseRole,
    permission_keys: permissionKeys,
  });

  revalidatePath("/admin/settings/members");
  return { message: `Role “${name}” created.` };
}

/** Replace a custom role's permission set. Gated by `roles.manage`. */
export async function setCustomRolePermissionsAction(
  _prev: MemberActionState,
  formData: FormData
): Promise<MemberActionState> {
  const actor = await requirePermission("roles.manage");

  const roleId = String(formData.get("roleId") ?? "");
  const permissionKeys = formData.getAll("permissionKeys").map(String);
  if (!roleId) return { error: "Missing role" };

  const supabase = await createClient();
  const { error: delError } = await supabase
    .from("role_permissions")
    .delete()
    .eq("custom_role_id", roleId);
  if (delError) return { error: delError.message };

  if (permissionKeys.length > 0) {
    const { error: insError } = await supabase
      .from("role_permissions")
      .insert(permissionKeys.map((k) => ({ custom_role_id: roleId, permission_key: k })));
    if (insError) return { error: insError.message };
  }

  await recordAudit(actor.id, actor.organisation_id, "custom_role.permissions_set", "custom_roles", roleId, {
    permission_keys: permissionKeys,
  });

  revalidatePath("/admin/settings/members");
  return { message: "Role permissions updated." };
}

/** Delete a custom role. Members holding it fall back to their base role. Gated by `roles.manage`. */
export async function deleteCustomRoleAction(
  _prev: MemberActionState,
  formData: FormData
): Promise<MemberActionState> {
  const actor = await requirePermission("roles.manage");

  const roleId = String(formData.get("roleId") ?? "");
  if (!roleId) return { error: "Missing role" };

  const supabase = await createClient();
  const { error } = await supabase.from("custom_roles").delete().eq("id", roleId);
  if (error) return { error: error.message };

  await recordAudit(actor.id, actor.organisation_id, "custom_role.deleted", "custom_roles", roleId, {});

  revalidatePath("/admin/settings/members");
  return { message: "Role deleted." };
}

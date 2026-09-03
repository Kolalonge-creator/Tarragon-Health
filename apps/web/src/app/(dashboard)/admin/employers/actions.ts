"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasAnyPermission } from "@/lib/auth/permissions";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";

export type EmployerActionState = { error?: string; message?: string } | undefined;

async function requireEmployerManage() {
  const allowed = await hasAnyPermission("orgs.manage", "orgs.corporate.manage");
  if (!allowed) throw new Error("You don't have access to do that");
}

const createEmployerSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

/** Module 26 §26.3 "Organisation registration" — the first step. Reuses the
 * existing admin_create_institution_org RPC (20260805234029), locked to
 * type=corporate here since this is the employer-specific console. */
export async function createEmployerOrgAction(
  _prev: EmployerActionState,
  formData: FormData
): Promise<EmployerActionState> {
  const allowed = await hasAnyPermission("orgs.manage", "orgs.corporate.manage");
  if (!allowed) return { error: "You don't have access to do that" };

  const parsed = createEmployerSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name" };

  const supabase = await createClient();
  const { data: orgId, error: orgError } = await supabase.rpc("admin_create_institution_org", {
    p_name: parsed.data.name,
    p_type: "corporate",
  });
  if (orgError) return { error: orgError.message };

  const { error: acctError } = await supabase
    .from("employer_accounts")
    .insert({ organisation_id: orgId, legal_name: parsed.data.name });
  if (acctError) return { error: acctError.message };

  revalidatePath("/admin/employers");
  return { message: `Employer "${parsed.data.name}" registered. Continue its onboarding below.` };
}

const employerProfileSchema = z.object({
  organisationId: z.string().uuid(),
  legalName: z.string().trim().max(200).optional().or(z.literal("").transform(() => undefined)),
  rcNumber: z.string().trim().max(50).optional().or(z.literal("").transform(() => undefined)),
  tin: z.string().trim().max(50).optional().or(z.literal("").transform(() => undefined)),
  industry: z.string().trim().max(100).optional().or(z.literal("").transform(() => undefined)),
  primaryContactName: z.string().trim().max(200).optional().or(z.literal("").transform(() => undefined)),
  primaryContactEmail: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  primaryContactPhone: z
    .string()
    .trim()
    .regex(/^\+[1-9][0-9]{7,14}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export async function updateEmployerProfileAction(
  _prev: EmployerActionState,
  formData: FormData
): Promise<EmployerActionState> {
  await requireEmployerManage();

  const parsed = employerProfileSchema.safeParse({
    organisationId: formData.get("organisationId"),
    legalName: formData.get("legalName"),
    rcNumber: formData.get("rcNumber"),
    tin: formData.get("tin"),
    industry: formData.get("industry"),
    primaryContactName: formData.get("primaryContactName"),
    primaryContactEmail: formData.get("primaryContactEmail"),
    primaryContactPhone: formData.get("primaryContactPhone"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid details" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("employer_accounts")
    .update({
      legal_name: parsed.data.legalName ?? null,
      rc_number: parsed.data.rcNumber ?? null,
      tin: parsed.data.tin ?? null,
      industry: parsed.data.industry ?? null,
      primary_contact_name: parsed.data.primaryContactName ?? null,
      primary_contact_email: parsed.data.primaryContactEmail ?? null,
      primary_contact_phone: parsed.data.primaryContactPhone ?? null,
      verification_submitted_at: new Date().toISOString(),
    })
    .eq("organisation_id", parsed.data.organisationId);
  if (error) return { error: error.message };

  revalidatePath(`/admin/employers/${parsed.data.organisationId}`);
  return { message: "Business details saved." };
}

const verificationSchema = z.object({
  organisationId: z.string().uuid(),
  status: z.enum(["unverified", "pending", "verified", "rejected"]),
  notes: z.string().trim().max(2000).optional().or(z.literal("").transform(() => undefined)),
});

export async function setEmployerVerificationAction(
  _prev: EmployerActionState,
  formData: FormData
): Promise<EmployerActionState> {
  await requireEmployerManage();

  const parsed = verificationSchema.safeParse({
    organisationId: formData.get("organisationId"),
    status: formData.get("status"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid details" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("employer_set_verification", {
    p_organisation_id: parsed.data.organisationId,
    p_status: parsed.data.status,
    p_notes: parsed.data.notes,
  });
  if (error) return { error: error.message };

  revalidatePath(`/admin/employers/${parsed.data.organisationId}`);
  return { message: `Verification set to ${parsed.data.status}.` };
}

const contractSchema = z.object({
  organisationId: z.string().uuid(),
  billingModel: z.enum(["per_employee", "per_active_member", "fixed_contract", "service_based", "hybrid"]),
  billingRateKobo: z.coerce.number().int().nonnegative().optional(),
  billingFixedAmountKobo: z.coerce.number().int().nonnegative().optional(),
  billingInterval: z.enum(["monthly", "yearly"]),
  signNow: z.coerce.boolean().optional(),
});

/**
 * Creates (or updates the open) contract for the org, capturing §26.15's
 * billing model. Signing separately (rather than always-on-save) matches the
 * platform's own attribution discipline — a contract shouldn't read as
 * "signed" just because a draft rate was typed in.
 */
export async function upsertEmployerContractAction(
  _prev: EmployerActionState,
  formData: FormData
): Promise<EmployerActionState> {
  const actor = await requireEmployerManageWithProfile();

  const parsed = contractSchema.safeParse({
    organisationId: formData.get("organisationId"),
    billingModel: formData.get("billingModel"),
    billingRateKobo: formData.get("billingRateKobo") || undefined,
    billingFixedAmountKobo: formData.get("billingFixedAmountKobo") || undefined,
    billingInterval: formData.get("billingInterval"),
    signNow: formData.get("signNow") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid contract details" };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("corporate_contracts")
    .select("id")
    .eq("organisation_id", parsed.data.organisationId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const patch = {
    billing_model: parsed.data.billingModel,
    billing_rate_kobo: parsed.data.billingRateKobo ?? null,
    billing_fixed_amount_kobo: parsed.data.billingFixedAmountKobo ?? null,
    billing_interval: parsed.data.billingInterval,
    ...(parsed.data.signNow ? { signed_at: new Date().toISOString(), signed_by: actor.id } : {}),
  };

  const { error } = existing
    ? await supabase.from("corporate_contracts").update(patch).eq("id", existing.id)
    : await supabase.from("corporate_contracts").insert({
        organisation_id: parsed.data.organisationId,
        name: "Employer contract",
        status: "active",
        ...patch,
      });
  if (error) return { error: error.message };

  revalidatePath(`/admin/employers/${parsed.data.organisationId}`);
  return { message: parsed.data.signNow ? "Contract saved and signed." : "Contract saved." };
}

async function requireEmployerManageWithProfile() {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in");
  await requireEmployerManage();
  return profile;
}

const goLiveSchema = z.object({ organisationId: z.string().uuid() });

export async function goLiveEmployerAction(
  _prev: EmployerActionState,
  formData: FormData
): Promise<EmployerActionState> {
  await requireEmployerManage();

  const parsed = goLiveSchema.safeParse({ organisationId: formData.get("organisationId") });
  if (!parsed.success) return { error: "Invalid organisation" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("employer_go_live", { p_organisation_id: parsed.data.organisationId });
  if (error) return { error: error.message };

  revalidatePath(`/admin/employers/${parsed.data.organisationId}`);
  return { message: "Employer is now live." };
}

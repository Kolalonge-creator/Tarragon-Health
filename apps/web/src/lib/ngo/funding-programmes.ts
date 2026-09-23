import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * Typed server-side wrappers for the ngo_funded_cohort module's RPCs
 * (migrations 20260922183610/20260922184145, fixed by 20260922184722 —
 * see packages/db/tests/ngo_funded_cohort.sql for the full proof). The
 * module ships dormant (public.platform_modules key "ngo_funded_cohort",
 * managed at /admin/settings/platform-modules like modules 27/28) — every
 * function here fails with a clear error until a superadmin activates it
 * for a real, signed NGO/PHC/government partnership. See
 * docs/FUNDING_STRATEGY.md for why: NGOs are a customer/implementation-
 * partner/subcontracting channel, not a grant source, and building a
 * self-serve UI on top of this ahead of an actual signed partner would
 * repeat the "shipped dormant, never onboarded" pattern this codebase has
 * already been burned by once (modules 27/28) — so no UI is built on these
 * yet, only this typed plumbing to build one on top of later. The two new
 * tables and their Row/Insert/Update/Relationships shapes, the two new
 * enums, and the five new RPC signatures were hand-spliced into
 * packages/shared/src/database.types.ts rather than regenerated wholesale —
 * see CLAUDE.md's "generate_typescript_types returns PRODUCTION" warning
 * (roughly 128 concurrent branches share one live project, so a full
 * regeneration would import everyone else's unmerged schema too).
 *
 * Every function takes an already-authenticated request-scoped client (RLS
 * decides who may actually call the underlying RPC) — never a service-role
 * client, so a caller cannot accidentally bypass the module gate or the
 * admin/ngo_admin authorisation each RPC checks internally.
 */

export type FundingProgrammeStatus = "draft" | "active" | "expired" | "cancelled";
export type FundingInvitationStatus = "invited" | "claimed" | "expired" | "revoked";

export type FundingProgramme = {
  id: string;
  organisation_id: string;
  service_product_id: string;
  name: string;
  contract_reference: string;
  funded_unit_cap: number;
  price_kobo: number | null;
  status: FundingProgrammeStatus;
  starts_at: string | null;
  ends_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FundingProgrammeInvitation = {
  id: string;
  funding_programme_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  status: FundingInvitationStatus;
  invite_token: string;
  invited_by: string;
  invited_at: string;
  expires_at: string;
  claimed_by_profile_id: string | null;
  claimed_at: string | null;
  care_voucher_id: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_at: string;
  updated_at: string;
};

const contactSchema = z.object({
  full_name: z.string().trim().min(1).max(200).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, "phone must be E.164, e.g. +2348012345678")
    .optional(),
  email: z.string().trim().email().optional(),
}).refine((c) => Boolean(c.phone || c.email), {
  message: "each contact needs a phone or an email",
});

export const inviteContactsSchema = z.array(contactSchema).min(1).max(500);

export type InviteContact = z.infer<typeof contactSchema>;

export type CreateFundingProgrammeInput = {
  organisationId: string;
  serviceProductId: string;
  name: string;
  contractReference: string;
  fundedUnitCap: number;
  priceKobo?: number;
  startsAt?: string;
  endsAt?: string;
};

/** Superadmin only — see private.is_admin() check inside the RPC. */
export async function createFundingProgramme(
  supabase: SupabaseClient<Database>,
  input: CreateFundingProgrammeInput
): Promise<string> {
  const { data, error } = await supabase.rpc("create_funding_programme", {
    p_organisation_id: input.organisationId,
    p_service_product_id: input.serviceProductId,
    p_name: input.name,
    p_contract_reference: input.contractReference,
    p_funded_unit_cap: input.fundedUnitCap,
    p_price_kobo: input.priceKobo,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
  });
  if (error) throw error;
  return data as string;
}

/** Superadmin only. Valid transitions: draft->active, active->expired|cancelled. */
export async function setFundingProgrammeStatus(
  supabase: SupabaseClient<Database>,
  programmeId: string,
  status: FundingProgrammeStatus,
  note?: string
): Promise<void> {
  const { error } = await supabase.rpc("set_funding_programme_status", {
    p_programme_id: programmeId,
    p_status: status,
    p_note: note,
  });
  if (error) throw error;
}

/**
 * Superadmin or the funding programme's own organisation's ngo_admin.
 * Refuses on a non-active programme and refuses a roster that would exceed
 * funded_unit_cap. Validated client-side too (Zod) so a malformed contact
 * list never reaches the RPC at all.
 */
export async function inviteToFundingProgramme(
  supabase: SupabaseClient<Database>,
  programmeId: string,
  contacts: InviteContact[]
): Promise<{ invited: number }> {
  const parsed = inviteContactsSchema.parse(contacts);
  const { data, error } = await supabase.rpc("invite_to_funding_programme", {
    p_programme_id: programmeId,
    p_contacts: parsed,
  });
  if (error) throw error;
  return data as { invited: number };
}

/** Superadmin or the owning organisation's ngo_admin; only a still-`invited` row. */
export async function revokeFundingProgrammeInvitation(
  supabase: SupabaseClient<Database>,
  invitationId: string,
  reason?: string
): Promise<void> {
  const { error } = await supabase.rpc("revoke_funding_programme_invitation", {
    p_invitation_id: invitationId,
    p_reason: reason,
  });
  if (error) throw error;
}

/**
 * The beneficiary's own claim, called with THEIR session after they've
 * signed up/signed in and followed their invitation link. Creates a real,
 * fully-paid, active care_vouchers row attributed to the funding
 * programme's own creator (never the inviting ngo_admin — see the module
 * header and the DB proof test for why that distinction is load-bearing).
 */
export async function claimFundingProgrammeInvitation(
  supabase: SupabaseClient<Database>,
  token: string
): Promise<{ voucher_id: string; voucher_number: string; sku_name: string; face_value_kobo: number }> {
  const { data, error } = await supabase.rpc("claim_funding_programme_invitation", {
    p_token: token,
  });
  if (error) throw error;
  return data as { voucher_id: string; voucher_number: string; sku_name: string; face_value_kobo: number };
}

/** Read-only: RLS scopes this to the caller's own organisation (or admin, to every row). */
export async function listFundingProgrammesForCaller(
  supabase: SupabaseClient<Database>
): Promise<FundingProgramme[]> {
  const { data, error } = await supabase
    .from("funding_programmes")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<FundingProgramme[]>();
  if (error) throw error;
  return data;
}

/** Read-only: RLS scopes this to invitations under a programme the caller can see. */
export async function listFundingProgrammeInvitations(
  supabase: SupabaseClient<Database>,
  programmeId: string
): Promise<FundingProgrammeInvitation[]> {
  const { data, error } = await supabase
    .from("funding_programme_invitations")
    .select("*")
    .eq("funding_programme_id", programmeId)
    .order("invited_at", { ascending: false })
    .returns<FundingProgrammeInvitation[]>();
  if (error) throw error;
  return data;
}

"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  demographicsSchema,
  consentSchema,
  identityVerificationSchema,
} from "@/lib/validation/onboarding";
import { verifyIdentity } from "@/lib/identity/provider";
import { firstIssue } from "@/lib/validation/first-issue";

export type SaveDemographicsState =
  | { error?: string; field?: string; success?: boolean }
  | undefined;

/**
 * Saves the patient's own date of birth + sex on their profiles row
 * (RLS-scoped — a patient may update their own profile). These are a hard
 * prerequisite for finishing onboarding (see
 * private.enforce_onboarding_prereqs) because the risk/screening engines are
 * age/sex-dependent.
 */
export async function saveDemographics(
  _prevState: SaveDemographicsState,
  formData: FormData,
): Promise<SaveDemographicsState> {
  const parsed = demographicsSchema.safeParse({
    dateOfBirth: formData.get("dateOfBirth"),
    sex: formData.get("sex"),
  });
  if (!parsed.success) {
    return firstIssue(parsed.error, "Check the details above and try again.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase
    .from("profiles")
    .update({ date_of_birth: parsed.data.dateOfBirth, sex: parsed.data.sex })
    .eq("id", user.id);
  if (error) {
    // Never the raw PostgREST string: it names tables, columns and
    // constraints, and says nothing a patient can act on.
    return { error: "We could not save that just then. Please try again." };
  }
  return { success: true };
}

export type AcceptConsentsState =
  | { error?: string; field?: string; success?: boolean }
  | undefined;

/**
 * Records the caller's acceptance of every current consent version as an
 * append-only patient_consents row. Idempotent-ish: re-accepting inserts new
 * rows (the audit history is intentional), but has_required_consents only
 * checks existence so a double-submit is harmless.
 */
export async function acceptConsents(
  _prevState: AcceptConsentsState,
  formData: FormData,
): Promise<AcceptConsentsState> {
  const parsed = consentSchema.safeParse({ accept: formData.get("accept") === "on" });
  if (!parsed.success) {
    return { error: "Tick the box to agree before continuing.", field: "accept" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return { error: "Your account is not set up yet. Please contact support." };
  }

  const { data: versions, error: versionsError } = await supabase
    .from("consent_versions")
    .select("id, consent_type, version")
    .eq("is_current", true);
  if (versionsError) {
    return { error: "We could not load the agreement just then. Please refresh and try again." };
  }
  if (!versions || versions.length === 0) {
    return { error: "The agreement is not available right now. Please contact support." };
  }

  const { error } = await supabase.from("patient_consents").insert(
    versions.map((version) => ({
      organisation_id: profile.organisation_id!,
      patient_id: user.id,
      consent_type: version.consent_type,
      consent_version_id: version.id,
      version: version.version,
    })),
  );
  if (error) {
    return { error: "We could not record your agreement just then. Please try again." };
  }
  return { success: true };
}

/**
 * Marks onboarding complete for the signed-in caller only — there is no
 * admin/staff path to set this on someone else's behalf (RLS already
 * restricts profiles updates to the owning user or org staff, but this
 * action never takes a patientId argument, so it can't be pointed at
 * another account even by mistake).
 */
export async function completeOnboarding() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  await supabase
    .from("profiles")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", user.id);

  // Land somebody where they were actually trying to go. `signup_intent` is
  // carried through auth metadata from /signup?intent=..., the same vehicle
  // phone/state/ref_code already use, so this needs no new column and no new
  // table. Anything unrecognised falls through to the normal dashboard, so a
  // stale or hand-typed value can never strand a new patient on a bad route.
  const intent = user.user_metadata?.signup_intent;
  if (intent === "health_check") redirect("/patient/prevention#health-check");

  // A supporter's home is the people they support. Landing them on a dashboard
  // of empty prompts about their own vitals is the moment the product stops
  // being the thing they signed up for.
  const { data: profile } = await supabase
    .from("profiles")
    .select("receives_care")
    .eq("id", user.id)
    .single();

  redirect(profile?.receives_care === false ? "/patient/supporting" : "/patient");
}

export type IdentityVerificationState =
  | { error?: string; field?: string; status?: "verified" | "failed" | "pending" | "unavailable" }
  | undefined;

/**
 * Optional KYC. Records a pending identity_verifications request (storing only
 * the last 4 digits of the ID number — never the full NIN/BVN), then attempts
 * verification through the provider boundary. When no provider is configured
 * the request simply stays pending for ops/webhook resolution. This is never a
 * blocker for onboarding.
 */
export async function submitIdentityVerification(
  _prevState: IdentityVerificationState,
  formData: FormData,
): Promise<IdentityVerificationState> {
  const parsed = identityVerificationSchema.safeParse({
    method: formData.get("method"),
    idNumber: formData.get("idNumber"),
    documentType: formData.get("documentType") || undefined,
  });
  if (!parsed.success) {
    return firstIssue(parsed.error, "Check the number and try again.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    return { error: "Your account is not set up yet. Please contact support." };
  }

  const idLast4 = parsed.data.idNumber.slice(-4);

  const { data: request, error: insertError } = await supabase
    .from("identity_verifications")
    .insert({
      organisation_id: profile.organisation_id,
      patient_id: user.id,
      method: parsed.data.method,
      status: "pending",
      id_last4: idLast4,
      metadata: parsed.data.method === "document" ? { document_type: parsed.data.documentType } : {},
    })
    .select("id")
    .single();
  if (insertError || !request) {
    return { error: "We could not record that just then. Please try again." };
  }

  // No provider does document verification (OCR/authenticity checks) — a document submission
  // always stays `pending` for org-staff manual review, same as a NIN/BVN submission with no
  // provider configured. Only nin/bvn go through the provider boundary.
  if (parsed.data.method === "document") {
    return { status: "pending" };
  }

  const result = await verifyIdentity(parsed.data.method, parsed.data.idNumber);

  if (result.ok) {
    // Verified/failed results are written via the service-role client so the
    // status can never be self-asserted by a patient session.
    const service = createServiceRoleClient();
    if (result.verified) {
      const verifiedAt = new Date().toISOString();
      await service
        .from("identity_verifications")
        .update({
          status: "verified",
          provider: result.provider,
          reference: result.reference,
          verified_at: verifiedAt,
        })
        .eq("id", request.id);
      // Routed through an RPC so the write can be attributed to the patient in public.audit_log
      // despite running on the service-role client — see
      // 20260812041044_service_role_write_actor_attribution.sql.
      await service.rpc("mark_identity_verified", {
        p_patient_id: user.id,
        p_verified_at: verifiedAt,
        p_actor_id: user.id,
      });
      return { status: "verified" };
    }
    // Provider reached, but the number didn't check out — a definitive fail.
    await service
      .from("identity_verifications")
      .update({ status: "failed", provider: result.provider })
      .eq("id", request.id);
    return { status: "failed" };
  }

  // Provider unavailable (unconfigured) or unreachable (transient error):
  // leave the request pending for a retry / ops resolution.
  return { status: result.reason === "unavailable" ? "unavailable" : "pending" };
}

"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { stiRiskCheckSchema } from "@/lib/validation/sti-risk-check";
import { scoreStiRiskCheck, type StiRiskLevel } from "@/lib/rules/sti-risk-assessment";
import type { Json, TablesInsert } from "@tarragon/shared";

export type SubmitStiRiskCheckState =
  | { error?: string; success?: boolean; riskLevel?: StiRiskLevel; recommendedScreenCodes?: string[] }
  | undefined;

/**
 * Records an STI risk/symptom check (spec §47.3). The score is computed here
 * (never trusting the client) and written to sti_risk_checks via the service
 * role — that table has no client-facing INSERT policy at all (see migration
 * 20260829090100), exactly the mental_health_screens tamper-resistance
 * pattern. A high risk level or a reported symptom also raises a
 * clinician_alerts row so a real person looks at it, not just the patient's
 * own recommendation screen.
 */
export async function submitStiRiskCheck(
  _prevState: SubmitStiRiskCheckState,
  formData: FormData
): Promise<SubmitStiRiskCheckState> {
  const parsed = stiRiskCheckSchema.safeParse({
    sexually_active_12mo: formData.get("sexually_active_12mo"),
    new_partner_3mo: formData.get("new_partner_3mo"),
    partner_count_12mo: formData.get("partner_count_12mo") || undefined,
    condom_use: formData.get("condom_use") || undefined,
    symptoms: formData.getAll("symptoms"),
    prior_sti_diagnosis: formData.get("prior_sti_diagnosis"),
    partner_diagnosed_sti: formData.get("partner_diagnosed_sti"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please answer every question" };
  }
  const answers = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const { riskLevel, symptomFlag, recommendedScreenCodes } = scoreStiRiskCheck(answers);

  const service = createServiceRoleClient();
  const { error: insertError } = await service.from("sti_risk_checks").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    risk_level: riskLevel,
    symptom_flag: symptomFlag,
    recommended_screen_codes: recommendedScreenCodes,
    responses: answers as unknown as Json,
  });
  if (insertError) return { error: insertError.message };

  // A reported symptom or a high risk level gets a real person to look at
  // it — never just left as a self-serve recommendation screen.
  if (symptomFlag || riskLevel === "high") {
    const alertRow: TablesInsert<"clinician_alerts"> = {
      organisation_id: profile.organisation_id,
      patient_id: user.id,
      level: "clinician_review",
      title: "Sexual health risk check needs a look",
      detail: symptomFlag
        ? `Patient reported a symptom on their sexual health risk check (risk level: ${riskLevel}). Recommended screens: ${recommendedScreenCodes.join(", ")}.`
        : `Patient's sexual health risk check came back high risk with no reported symptoms. Recommended screens: ${recommendedScreenCodes.join(", ")}.`,
    };
    // Only the symptom case has an obvious, honest type_code — a plain
    // high-risk-no-symptoms check is left for
    // private.classify_and_assign_clinician_alert's own default rather than
    // guessing one.
    if (symptomFlag) {
      alertRow.category = "clinical";
      alertRow.type_code = "symptom_escalation";
    }
    await service.from("clinician_alerts").insert(alertRow);
  }

  return { success: true, riskLevel, recommendedScreenCodes };
}

export type PartnerCopyTemplates = { smsTemplate: string; whatsappTemplate: string };
export type RequestSelfNotifyPartnerCopyResult = { error: string } | PartnerCopyTemplates;

const episodeIdSchema = z.string().uuid("Invalid case reference");

/**
 * Hands the patient copy-ready message templates to forward to a partner
 * themselves — Tarragon never sends anything to a third party on the
 * patient's behalf (spec §47.6). Recording that the patient opened this flow
 * (method='self_notify') is the whole point of the call, not a side effect:
 * consent_given_at defaults to now() and RLS (sti_partner_notifications_insert)
 * already restricts this to the caller's own patient_id on a case episode
 * they own, so the patient's own session is enough — no service role needed.
 */
export async function requestSelfNotifyPartnerCopy(
  stiCaseEpisodeId: string
): Promise<RequestSelfNotifyPartnerCopyResult> {
  const parsedId = episodeIdSchema.safeParse(stiCaseEpisodeId);
  if (!parsedId.success) return { error: parsedId.error.issues[0]?.message ?? "Invalid case reference" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const { error: insertError } = await supabase.from("sti_partner_notifications").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    sti_case_episode_id: parsedId.data,
    method: "self_notify",
    created_by: user.id,
  });
  if (insertError) return { error: insertError.message };

  return {
    smsTemplate:
      "Hi — I wanted to let you know it's worth getting checked for STIs. No pressure, just thought you should know. Most clinics/pharmacies can test quickly.",
    whatsappTemplate:
      "Hey, hope you're doing okay. I wanted to give you a heads-up that it's worth getting an STI check soon — no pressure at all, just thought you'd want to know. Most clinics, labs and even some pharmacies can test quickly and confidentially, so it doesn't have to be a big deal.",
  };
}

export type SubmitClinicianAssistedPartnerNotificationResult = { error: string } | { success: true };

const clinicianAssistedSchema = z.object({
  stiCaseEpisodeId: z.string().uuid("Invalid case reference"),
  partnerLabel: z.string().trim().max(120).optional(),
  partnerContact: z.string().trim().min(1, "Add a phone number or contact detail").max(200),
});

/**
 * Patient-consented handoff to the care team to attempt partner contact
 * themselves (method='clinician_assisted', spec §47.6) — never an automated
 * send. Same RLS-only, no-service-role shape as requestSelfNotifyPartnerCopy:
 * the patient consenting to their own record is exactly what
 * sti_partner_notifications_insert already allows.
 */
export async function submitClinicianAssistedPartnerNotification(
  stiCaseEpisodeId: string,
  partnerLabel: string | null,
  partnerContact: string
): Promise<SubmitClinicianAssistedPartnerNotificationResult> {
  const parsed = clinicianAssistedSchema.safeParse({
    stiCaseEpisodeId,
    partnerLabel: partnerLabel || undefined,
    partnerContact,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please fill in the partner's contact details" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) return { error: "No organisation on file" };

  const { error: insertError } = await supabase.from("sti_partner_notifications").insert({
    organisation_id: profile.organisation_id,
    patient_id: user.id,
    sti_case_episode_id: parsed.data.stiCaseEpisodeId,
    method: "clinician_assisted",
    partner_label: parsed.data.partnerLabel ?? null,
    partner_contact: parsed.data.partnerContact,
    created_by: user.id,
  });
  if (insertError) return { error: insertError.message };

  return { success: true };
}

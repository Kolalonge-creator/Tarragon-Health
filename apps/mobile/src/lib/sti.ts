import { supabase } from "./supabase";
import { postStiRiskCheck } from "./api";
import { loadLabPanelBundles, type PanelBundle } from "./labs";
import type { QueryResult } from "./medications";
import type { Enums, Tables } from "@tarragon/shared";

/**
 * STI testing, risk-check, case-status tracking, and partner notification
 * (spec §47.3-§47.6). Mirrors apps/web/.../patient/sexual-health/sti-actions.ts
 * + lib/queries/{sti-case-episodes,sti-partner-notifications}.ts.
 *
 * **Every function here takes patientId/organisationId as the DEVICE
 * OWNER'S OWN ids only — never route these through acting.ts's
 * getActingFor()/resolveSubjectId().** Every table this module touches is
 * patient-self-or-org-staff only by construction, with no
 * profile_access/supporter/can_act_for path at all (see
 * docs/mobile-native-conversion/sexual-health.md's safety notes) — there is
 * no server-side path that would honour a subject id even if one were
 * plumbed through.
 */

// ---------------------------------------------------------------------------
// Risk check (scored + inserted server-side, via api.ts)
// ---------------------------------------------------------------------------

export const STI_PARTNER_COUNTS = ["0", "1", "2_4", "5_plus"] as const;
export type StiPartnerCount = (typeof STI_PARTNER_COUNTS)[number];
export const STI_PARTNER_COUNT_LABEL: Record<StiPartnerCount, string> = {
  "0": "None",
  "1": "One",
  "2_4": "Two to four",
  "5_plus": "Five or more",
};

export const STI_CONDOM_USES = ["always", "sometimes", "never"] as const;
export type StiCondomUse = (typeof STI_CONDOM_USES)[number];
export const STI_CONDOM_USE_LABEL: Record<StiCondomUse, string> = {
  always: "Always",
  sometimes: "Sometimes",
  never: "Rarely or never",
};

export const STI_SYMPTOMS = ["discharge", "genital_sores", "pain_urination", "pelvic_pain", "pain_during_sex", "none"] as const;
export type StiSymptom = (typeof STI_SYMPTOMS)[number];
export const STI_SYMPTOM_LABEL: Record<StiSymptom, string> = {
  discharge: "Unusual discharge",
  genital_sores: "Sores, bumps, or blisters",
  pain_urination: "Pain or burning when you pee",
  pelvic_pain: "Pelvic or lower belly pain",
  pain_during_sex: "Pain during sex",
  none: "None of these",
};

// Only codes scoreStiRiskCheck can actually produce — syphilis and
// chlamydia_gonorrhoea are deliberately absent, neither has a bookable
// product since 2026-09-04.
export const RECOMMENDED_SCREEN_LABEL: Record<string, string> = {
  hiv: "HIV",
  hep_b: "Hepatitis B",
  hep_c: "Hepatitis C",
};

export interface StiRiskCheckAnswers {
  sexually_active_12mo: boolean;
  new_partner_3mo: boolean;
  partner_count_12mo?: StiPartnerCount;
  condom_use?: StiCondomUse;
  symptoms: StiSymptom[];
  prior_sti_diagnosis: boolean;
  partner_diagnosed_sti: boolean;
}

export interface StiRiskCheckResult {
  riskLevel: "low" | "moderate" | "high";
  recommendedScreenCodes: string[];
}

/** Validates the same shape stiRiskCheckSchema enforces web-side, then
 * posts to the scored, service-role-backed route — never a direct client
 * insert (sti_risk_checks has no client-facing INSERT policy at all). */
export async function submitStiRiskCheck(answers: StiRiskCheckAnswers): Promise<QueryResult<StiRiskCheckResult>> {
  if (answers.symptoms.includes("none") && answers.symptoms.length > 1) {
    return { ok: false, error: '"None of these" can\'t be combined with another symptom' };
  }
  if (answers.sexually_active_12mo) {
    if (!answers.partner_count_12mo) return { ok: false, error: "Let us know roughly how many partners" };
    if (!answers.condom_use) return { ok: false, error: "Let us know about condom use" };
    if (answers.symptoms.length === 0) return { ok: false, error: 'Choose anything that applies, or "None of these"' };
  }

  const result = await postStiRiskCheck({ ...answers });
  if (result.error || !result.success) return { ok: false, error: result.error ?? "Please answer every question" };
  return { ok: true, data: { riskLevel: (result.riskLevel as StiRiskCheckResult["riskLevel"]) ?? "low", recommendedScreenCodes: result.recommendedScreenCodes ?? [] } };
}

// ---------------------------------------------------------------------------
// Case-status tracker (read-only) + partner notification
// ---------------------------------------------------------------------------

export type StiCaseEpisode = Tables<"sti_case_episodes">;
export type StiCaseStatus = Enums<"sti_case_status">;
export type StiPartnerNotification = Tables<"sti_partner_notifications">;

const OPEN_EXCLUDED_STATUSES = ["closed", "declined_care"];

/** The patient's own open (not closed/declined) curable-STI case episodes,
 * newest first. Confidential-by-construction table, patient-self or org
 * staff only — no supporter/profile_access visibility. */
export async function loadOpenStiCaseEpisodes(patientId: string): Promise<StiCaseEpisode[]> {
  const { data } = await supabase
    .from("sti_case_episodes")
    .select("*")
    .eq("patient_id", patientId)
    .not("status", "in", `(${OPEN_EXCLUDED_STATUSES.join(",")})`)
    .order("created_at", { ascending: false });
  return (data ?? []) as StiCaseEpisode[];
}

export async function loadPartnerNotifications(stiCaseEpisodeId: string): Promise<StiPartnerNotification[]> {
  const { data } = await supabase
    .from("sti_partner_notifications")
    .select("*")
    .eq("sti_case_episode_id", stiCaseEpisodeId)
    .order("created_at", { ascending: false });
  return (data ?? []) as StiPartnerNotification[];
}

export interface PartnerCopyTemplates {
  smsTemplate: string;
  whatsappTemplate: string;
}

/** Hands the patient copy-ready message templates to forward themselves —
 * Tarragon never sends anything to a third party. Recording that the
 * patient opened this flow is the whole point (method='self_notify'); a
 * plain RLS-scoped insert, no service role — sti_partner_notifications_insert
 * already restricts this to the caller's own patient_id on an owned
 * episode. */
export async function requestSelfNotifyPartnerCopy(
  patientId: string,
  organisationId: string,
  stiCaseEpisodeId: string
): Promise<QueryResult<PartnerCopyTemplates>> {
  const { error } = await supabase.from("sti_partner_notifications").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    sti_case_episode_id: stiCaseEpisodeId,
    method: "self_notify",
    created_by: patientId,
  });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: {
      smsTemplate:
        "Hi, I wanted to let you know it's worth getting checked for STIs. No pressure, just thought you should know. Most clinics/pharmacies can test quickly.",
      whatsappTemplate:
        "Hey, hope you're doing okay. I wanted to give you a heads-up that it's worth getting an STI check soon. No pressure at all, just thought you'd want to know. Most clinics, labs and even some pharmacies can test quickly and confidentially, so it doesn't have to be a big deal.",
    },
  };
}

/** Patient-consented handoff to the care team to attempt partner contact
 * themselves (method='clinician_assisted') — never an automated send. Same
 * RLS-only shape as requestSelfNotifyPartnerCopy. */
export async function submitClinicianAssistedPartnerNotification(
  patientId: string,
  organisationId: string,
  stiCaseEpisodeId: string,
  partnerLabel: string | null,
  partnerContact: string
): Promise<QueryResult<null>> {
  const contact = partnerContact.trim();
  if (!contact) return { ok: false, error: "Add a phone number or contact detail" };
  const { error } = await supabase.from("sti_partner_notifications").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    sti_case_episode_id: stiCaseEpisodeId,
    method: "clinician_assisted",
    partner_label: partnerLabel?.trim() || null,
    partner_contact: contact,
    created_by: patientId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// STI test catalogue (guidance only — see StiBookingPanel in
// sexual-health-testing-tab.tsx). Tarragon does not book or bill any of
// these; bookStiTest/postLabOrderCheckout were removed once every
// panel_bundles row became guidance_only (migration
// 20260910011846_catalogue_becomes_guidance_not_commerce.sql).
// ---------------------------------------------------------------------------

/** The self-bookable STI/BBV-relevant bundles, in the order we want them to
 * read — mirrors apps/web/.../patient/sexual-health/sti-testing-panel.tsx's
 * STI_BUNDLE_CODES exactly (kept in sync there, not re-derived from any
 * flag on the row itself). `single_chlamydia_gonorrhoea`/`sti_panel_full`
 * were withdrawn in the 2026-09-03 catalogue rebuild and would disappear
 * from this list on their own via the is_active/self_bookable filter even
 * if left in, but aren't listed here either. */
export const STI_BUNDLE_CODES = ["single_hiv", "single_syphilis", "single_hep_b", "single_hep_c", "blood_borne_virus_screen"] as const;

/** Loads the shared panel_bundles catalogue and filters/orders it down to
 * the STI-relevant, currently self-bookable bundles — the native
 * equivalent of sti-testing-panel.tsx's useLabCatalogue + STI_BUNDLE_CODES
 * filter. */
export async function loadStiBookableBundles(): Promise<PanelBundle[]> {
  const bundles = await loadLabPanelBundles();
  const byCode = new Map(bundles.map((b) => [b.code, b] as const));
  return STI_BUNDLE_CODES.map((code) => byCode.get(code)).filter(
    (b): b is PanelBundle => !!b && b.is_active === true && b.self_bookable === true
  );
}

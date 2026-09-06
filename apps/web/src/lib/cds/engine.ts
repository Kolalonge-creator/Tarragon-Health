/**
 * Clinical Decision Support engine (spec §38).
 *
 * PURE. No I/O, no Supabase client, no clock reads beyond what the caller
 * hands in — same discipline as lib/rules/drug-safety.ts and
 * lib/rules/longitudinal.ts, and for the same reason: every rule here needs
 * to be exercised in a unit test without a database, and the point-of-care
 * panel needs the exact same recommendations the tests already proved.
 *
 * This module does not invent new clinical logic. Every recommendation below
 * is a thin wrapper around a decision already computed elsewhere on the
 * platform (drug-safety findings, the HBPM target comparison, drug-triggered
 * lab monitoring, condition-review cadences, resistant/young-onset HTN flags,
 * KDIGO CKD risk) — CDS's job (§38.4) is to bring what's ALREADY known into
 * one point-of-care view with a visible source and a visible reason, not to
 * re-derive the clinical facts a second time.
 *
 * ADVISORY, NEVER A BLOCK (§38.1 "augment clinicians rather than replace
 * them"): nothing here can be used to gate a write anywhere in the app.
 */
import type { SafetyReport, DrugSafetySeverity } from "@/lib/rules/drug-safety";
import type { CdsRecommendation, CdsPriority } from "./types";

const SEVERITY_TO_PRIORITY: Record<DrugSafetySeverity, CdsPriority> = {
  contraindicated: "high",
  caution: "medium",
  info: "low",
};

const DRUG_SAFETY_SOURCE = "Tarragon curated drug-safety engine (interactions, duplicate therapy, allergy, renal dosing)";

export interface HbpmContext {
  target: { systolic: number; diastolic: number; source: string };
  average: {
    systolic: number;
    diastolic: number;
    n_readings: number;
    n_days: number;
    meets_home_htn: boolean;
    at_target: boolean;
  } | null;
}

/** Same vocabulary as private.bp_secondary_htn_flags / bp-ladder-panel.tsx's SECONDARY_FLAG_LABEL. */
export type BpSecondaryFlag = "young_onset_under_40" | "resistant_htn" | (string & {});

const BP_SECONDARY_FLAG_COPY: Partial<Record<string, { title: string; triggerText: string; priority: CdsPriority }>> = {
  resistant_htn: {
    title: "Referral pathway may be appropriate.",
    triggerText:
      "Above target on 3 or more antihypertensives including a diuretic — resistant hypertension. Confirm adherence, exclude secondary causes and white-coat effect, and consider a specialist referral.",
    priority: "high",
  },
  young_onset_under_40: {
    title: "Referral pathway may be appropriate.",
    triggerText:
      "Confirmed hypertension diagnosed under age 40. Consider assessment for a secondary cause before continuing routine step-up.",
    priority: "medium",
  },
};

export interface PendingLabMonitoring {
  id: string;
  medicationId: string;
  drugClass: string;
  monitoringLabel: string;
  /** null = "as clinically indicated" — never surfaced as a due-date alert (nothing to be overdue against). */
  dueDate: string | null;
}

export interface PendingConditionReview {
  id: string;
  /** care_plans.condition, e.g. 'diabetes' | 'hypertension' | 'cardiovascular' | 'ckd' | 'obesity' | 'other'. */
  condition: string;
  dueDate: string;
}

export type CkdRiskCategory = "low" | "moderate" | "high" | "very_high";

export interface CdsEngineInput {
  medicationSafety: SafetyReport;
  hbpm: HbpmContext | null;
  bpSecondaryFlags: BpSecondaryFlag[];
  pendingLabMonitoring: PendingLabMonitoring[];
  pendingConditionReviews: PendingConditionReview[];
  ckdRiskCategory: CkdRiskCategory | null;
  /** Injected, never `new Date()` inside the engine, so "overdue" is testable and reproducible. */
  now: Date;
}

const CONDITION_LABEL: Record<string, string> = {
  hypertension: "Hypertension",
  diabetes: "Diabetes",
  cardiovascular: "Cardiovascular risk",
  ckd: "CKD",
  obesity: "Weight management",
  other: "Chronic condition",
};

function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Drug-safety findings, verbatim (§38.6/§38.7/§38.8: interaction, allergy,
 * duplicate therapy, renal dosing). This engine adds nothing to the clinical
 * judgment already made in assessMedicationSafety — only presentation.
 */
function fromMedicationSafety(report: SafetyReport): CdsRecommendation[] {
  return report.findings.map((finding) => {
    const idPart = [...finding.medicationIds].sort().join("+") || finding.drugNames.slice().sort().join("+");
    return {
      key: `medication_safety:${finding.kind}:${idPart}`,
      fingerprint: `${finding.kind}|${finding.severity}|${idPart}`,
      category: "medication_safety",
      priority: SEVERITY_TO_PRIORITY[finding.severity],
      title: finding.title,
      triggerText: finding.message,
      sourceLabel: DRUG_SAFETY_SOURCE,
      medicationIds: finding.medicationIds.length > 0 ? finding.medicationIds : undefined,
    };
  });
}

/** §38.3 "BP remains uncontrolled." — driven by the same HBPM-vs-target comparison hbpm_summary already computes. */
function fromBpControl(hbpm: HbpmContext | null): CdsRecommendation[] {
  if (!hbpm?.average || hbpm.average.at_target) return [];
  const { systolic, diastolic, n_readings, n_days } = hbpm.average;
  return [
    {
      key: "bp_uncontrolled",
      fingerprint: `${systolic}/${diastolic}|target:${hbpm.target.systolic}/${hbpm.target.diastolic}|n:${n_readings}`,
      category: "chronic_disease_control",
      priority: "medium",
      title: "BP remains uncontrolled.",
      triggerText: `The patient's home BP average (${systolic}/${diastolic} mmHg over ${n_readings} readings across ${n_days} days) remains above their treatment target of ${hbpm.target.systolic}/${hbpm.target.diastolic} mmHg.`,
      sourceLabel: `Tarragon Hypertension Pathway (Nigeria HEARTS) — target source: ${hbpm.target.source}`,
    },
  ];
}

/** §38.3 "Referral pathway may be appropriate." — resistant/young-onset HTN and very-high KDIGO risk. */
function fromReferralFlags(flags: BpSecondaryFlag[], ckdRiskCategory: CkdRiskCategory | null): CdsRecommendation[] {
  const out: CdsRecommendation[] = [];
  for (const flag of flags) {
    const copy = BP_SECONDARY_FLAG_COPY[flag];
    if (!copy) continue; // an unrecognised flag is shown nowhere rather than guessed at
    out.push({
      key: `referral:${flag}`,
      fingerprint: flag, // presence is the only fact; it either fired or it didn't
      category: "referral",
      priority: copy.priority,
      title: copy.title,
      triggerText: copy.triggerText,
      sourceLabel: "Tarragon Hypertension Pathway (Nigeria HEARTS) §7.3/§18.6 secondary-cause criteria",
    });
  }
  if (ckdRiskCategory === "very_high") {
    out.push({
      key: "referral:ckd_very_high",
      fingerprint: "very_high",
      category: "referral",
      priority: "high",
      title: "Referral pathway may be appropriate.",
      triggerText:
        "The patient's combined eGFR-and-albuminuria (KDIGO) risk category is very high. Consider a nephrology referral.",
      sourceLabel: "KDIGO CKD risk classification (GFR × albuminuria)",
    });
  }
  return out;
}

/** §38.9/§38.10 "Medication monitoring is due." — drug-triggered lab monitoring already scheduled by the platform. */
function fromLabMonitoring(items: PendingLabMonitoring[], now: Date): CdsRecommendation[] {
  const today = toIsoDay(now);
  return items
    .filter((item) => item.dueDate !== null && item.dueDate <= today) // due or overdue only; "as clinically indicated" (null) is never alerted on a timer
    .map((item) => ({
      key: `monitoring:${item.medicationId}:${item.monitoringLabel}`,
      fingerprint: `${item.medicationId}|${item.monitoringLabel}|${item.dueDate}`,
      category: "monitoring",
      priority: "medium" as CdsPriority,
      title: "Medication monitoring is due.",
      triggerText: `${item.drugClass} — ${item.monitoringLabel} was due ${item.dueDate}.`,
      sourceLabel: "Drug-class lab monitoring schedule",
      medicationIds: [item.medicationId],
    }));
}

/** §38.10 "Diabetes monitoring is overdue." / "annual cardiovascular risk review is due." — condition-review cadences already tracked in medication_reviews. */
function fromConditionReviews(items: PendingConditionReview[], now: Date): CdsRecommendation[] {
  const today = toIsoDay(now);
  return items
    .filter((item) => item.dueDate <= today)
    .map((item) => {
      const label = CONDITION_LABEL[item.condition] ?? item.condition;
      const title = item.condition === "diabetes" ? "Diabetes monitoring is overdue." : `${label} review is due.`;
      return {
        key: `condition_review:${item.id}`,
        fingerprint: `${item.id}|${item.dueDate}`,
        category: "monitoring" as const,
        priority: "medium" as CdsPriority,
        title,
        triggerText: `The scheduled ${label.toLowerCase()} medication review was due ${item.dueDate}.`,
        sourceLabel: "Medication review cadence (condition-specific, medication_review_cadences)",
      };
    });
}

/** Assembles every rule family above into one recommendation list. Order is not significance — see prioritise.ts. */
export function computeCdsRecommendations(input: CdsEngineInput): CdsRecommendation[] {
  return [
    ...fromMedicationSafety(input.medicationSafety),
    ...fromBpControl(input.hbpm),
    ...fromReferralFlags(input.bpSecondaryFlags, input.ckdRiskCategory),
    ...fromLabMonitoring(input.pendingLabMonitoring, input.now),
    ...fromConditionReviews(input.pendingConditionReviews, input.now),
  ];
}

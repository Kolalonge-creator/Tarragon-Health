/**
 * CMO Clinical Operations and Performance (slice 1, 2026-11-07): the patient journey and operational warnings.
 *
 * Built on public.cmo_patient_journey_summary() (org-wide counts, oldest ages and medians, no identities). Rules:
 *  - Operational warnings are not safety items. They never go above "requires attention", and only an item past a RECORDED due
 *    date reaches it; everything else is "routine" with its age shown. Safety stays on the Leadership overview.
 *  - No target is invented. Until the CMO signs operational targets, every figure says "No approved target".
 *  - Longitudinal care has no finish line, and not every patient needs every investigation, so each stage is shown as a share of
 *    all registered patients, never as a completion or failure rate. The stages are not nested (a coordinator can be assigned
 *    before onboarding finishes; a patient can upload a result with no order), so a "share of the previous stage" could pass 100%
 *    and is not shown.
 */
import type { ExecutiveAttentionItem } from "./cmo-leadership";

export type JourneyAwaitingKey =
  | "onboarding"
  | "care_plan_approval"
  | "investigation_result"
  | "doctor_review"
  | "follow_up_open"
  | "follow_up_overdue"
  | "no_coordinator";

export type JourneySummary = {
  generatedAt: string;
  stages: {
    registered: number;
    onboarded: number;
    with_coordinator: number;
    care_plan_approved: number;
    investigation_ordered: number;
    result_received: number;
    result_reviewed: number;
    follow_up_raised: number;
    follow_up_all_closed: number;
  };
  /** Patients with a current uploaded result document: the denominator for "reviewed", since review is recorded on documents. */
  withResultDocument: number;
  awaiting: Record<JourneyAwaitingKey, { count: number; oldest_days: number | null }>;
  median_hours: {
    registered_to_onboarded: number | null;
    ordered_to_resulted: number | null;
    uploaded_to_reviewed: number | null;
    follow_up_raised_to_closed: number | null;
  };
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

const STAGE_KEYS = [
  "registered",
  "onboarded",
  "with_coordinator",
  "care_plan_approved",
  "investigation_ordered",
  "result_received",
  "result_reviewed",
  "follow_up_raised",
  "follow_up_all_closed",
] as const;
const AWAITING_KEYS: readonly JourneyAwaitingKey[] = [
  "onboarding",
  "care_plan_approval",
  "investigation_result",
  "doctor_review",
  "follow_up_open",
  "follow_up_overdue",
  "no_coordinator",
];
const MEDIAN_KEYS = ["registered_to_onboarded", "ordered_to_resulted", "uploaded_to_reviewed", "follow_up_raised_to_closed"] as const;

/** Parses the RPC answer. Any missing or malformed count makes the whole summary null ("could not be loaded"), never zeros. */
export function parseJourneySummary(raw: unknown): JourneySummary | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const stagesRaw = r.stages as Record<string, unknown> | undefined;
  const awaitingRaw = r.awaiting as Record<string, Record<string, unknown> | undefined> | undefined;
  const mediansRaw = (r.median_hours ?? {}) as Record<string, unknown>;
  if (!stagesRaw || !awaitingRaw || typeof r.generated_at !== "string") return null;

  const stages = {} as JourneySummary["stages"];
  for (const k of STAGE_KEYS) {
    const v = num(stagesRaw[k]);
    if (v === null) return null;
    stages[k] = v;
  }
  const withResultDocument = num(stagesRaw.with_result_document);
  if (withResultDocument === null) return null;
  const awaiting = {} as JourneySummary["awaiting"];
  for (const k of AWAITING_KEYS) {
    const a = awaitingRaw[k];
    const count = num(a?.count);
    if (count === null) return null;
    awaiting[k] = { count, oldest_days: num(a?.oldest_days) };
  }
  const median_hours = {} as JourneySummary["median_hours"];
  for (const k of MEDIAN_KEYS) median_hours[k] = num(mediansRaw[k]);
  return { generatedAt: r.generated_at, stages, withResultDocument, awaiting, median_hours };
}

export type JourneyStage = {
  key: (typeof STAGE_KEYS)[number];
  label: string;
  definition: string;
  reached: number;
  /** Share of all registered patients who reached this stage, as "a of b"; null for the first stage or when nobody is registered. */
  ofRegistered: { pct: number; text: string } | null;
  /** Where to act on patients who have not yet reached this stage. */
  href: string;
};

const STAGE_META: Record<(typeof STAGE_KEYS)[number], { label: string; definition: string; href: string }> = {
  registered: { label: "Registered", definition: "Patient accounts, test accounts excluded.", href: "/clinician/patients" },
  onboarded: { label: "Onboarding completed", definition: "Finished the onboarding questions.", href: "/clinician/operations/journey#awaiting-onboarding" },
  with_coordinator: { label: "Care coordinator assigned", definition: "A named coordinator on the care team.", href: "/clinician/operations/journey#awaiting-no_coordinator" },
  care_plan_approved: { label: "Care plan approved", definition: "A care plan that is active or completed (a draft is awaiting approval).", href: "/clinician/care-plan-review" },
  investigation_ordered: { label: "Investigation ordered", definition: "A lab order past payment and not cancelled.", href: "/clinician/orders" },
  result_received: { label: "Result received", definition: "A resulted lab order or an uploaded result document.", href: "/clinician/lab-results" },
  result_reviewed: { label: "Result reviewed by a doctor", definition: "An uploaded result document marked reviewed.", href: "/clinician/lab-results" },
  follow_up_raised: { label: "Follow-up raised", definition: "A clinical follow-up was opened (orders, referrals, lab requests, follow-ups).", href: "/clinician/follow-ups" },
  follow_up_all_closed: { label: "Follow-up closed", definition: "Every follow-up for the patient closed with a recorded outcome.", href: "/clinician/follow-ups" },
};

export function journeyStages(s: JourneySummary): JourneyStage[] {
  const registered = s.stages.registered;
  return STAGE_KEYS.map((key, i) => {
    const reached = s.stages[key];
    const ofRegistered =
      i === 0 || registered === 0
        ? null
        : { pct: Math.round((reached / registered) * 100), text: `${reached.toLocaleString("en-NG")} of ${registered.toLocaleString("en-NG")}` };
    return { key, ...STAGE_META[key], reached, ofRegistered };
  });
}

export const AWAITING_META: Record<JourneyAwaitingKey, { label: string; team: string; action: string; href: string; dueDateBased: boolean }> = {
  follow_up_overdue: { label: "Follow-ups past their due date", team: "Follow-up owners (doctors)", action: "Open follow-ups", href: "/clinician/follow-ups", dueDateBased: true },
  doctor_review: { label: "Uploaded results waiting for a doctor's review", team: "Doctors", action: "Open lab results", href: "/clinician/lab-results", dueDateBased: false },
  investigation_result: { label: "Lab orders waiting for a result", team: "Care coordination and lab liaison", action: "Open orders", href: "/clinician/orders", dueDateBased: false },
  care_plan_approval: { label: "Patients whose only care plan is a draft", team: "Doctors", action: "Open care plan review", href: "/clinician/care-plan-review", dueDateBased: false },
  onboarding: { label: "Patients who have not finished onboarding", team: "Care coordination", action: "Open patients", href: "/clinician/patients", dueDateBased: false },
  no_coordinator: { label: "Patients with no care coordinator assigned", team: "Operations", action: "Open team caseload", href: "/clinician/team-caseload", dueDateBased: false },
  follow_up_open: { label: "Follow-ups still open", team: "Follow-up owners (doctors)", action: "Open follow-ups", href: "/clinician/follow-ups", dueDateBased: false },
};

/** Order of the warnings panel when tiers tie: due-date breaches first, then the steps nearest to a patient's care. */
const WARNING_ORDER: readonly JourneyAwaitingKey[] = [
  "follow_up_overdue",
  "doctor_review",
  "investigation_result",
  "care_plan_approval",
  "onboarding",
  "no_coordinator",
];

/**
 * Operational warnings from the journey summary. `follow_up_open` is left out (its overdue part is its own line). Only a breach of
 * a recorded due date is "attention"; the rest are "routine". The raised time is the oldest item's age, so the panel can show it.
 */
export function operationalWarnings(s: JourneySummary, now: Date): ExecutiveAttentionItem[] {
  const out: ExecutiveAttentionItem[] = [];
  for (const key of WARNING_ORDER) {
    const a = s.awaiting[key];
    if (a.count <= 0) continue;
    const meta = AWAITING_META[key];
    out.push({
      key: `ops:${key}`,
      tier: meta.dueDateBased ? "attention" : "routine",
      kind: "Operational",
      title: `${a.count.toLocaleString("en-NG")} ${meta.label.charAt(0).toLowerCase()}${meta.label.slice(1)}`,
      raisedAt: a.oldest_days === null ? null : new Date(now.getTime() - a.oldest_days * 86_400_000).toISOString(),
      owner: meta.team,
      status: meta.dueDateBased ? "Past due date" : "Waiting",
      nextAction: meta.action,
      href: meta.href,
    });
  }
  return out;
}

/** "36 hours", "2.5 days", or null when there is no completed example to measure. */
export function medianText(hours: number | null): string | null {
  if (hours === null) return null;
  if (hours < 48) return `${Math.round(hours * 10) / 10} hours`;
  return `${Math.round((hours / 24) * 10) / 10} days`;
}

/**
 * Health Domains — a patient-facing grouping of signals Tarragon already
 * computes (patient_risk_scores via usePatientRiskSignals, reviewed-lab
 * rollups via getBiomarkerCategories, synced sleep via useSleepSummary)
 * into 9 named domains across two horizons patients actually think in:
 *
 *  - "energy": what's shaping how someone feels today
 *  - "future_health": longer-horizon organ-system risk
 *
 * Deliberately presentation-only, same discipline as
 * lib/ai-coach/composed-surfaces.ts: no new scoring, no new DB table, no
 * LLM call. Every domain's status and narrative is a template built from
 * values already computed elsewhere. A domain with nothing behind it
 * renders as "no_data" rather than a fabricated status — the same rule
 * lib/lab-reports/biomarker-categories.ts already follows for its own
 * categories.
 *
 * kidney/liver biomarker categories are deliberately NOT folded into any
 * of these 9 domains — there's no honest fit in this taxonomy, so they
 * stay visible only via the existing BiomarkerCategoriesCard.
 */

import type { Enums } from "@tarragon/shared";
import type { BiomarkerCategoryView } from "@/lib/lab-reports/biomarker-categories";
import { SLEEP_TREND_LABEL, type SleepSummary } from "@/lib/queries/wearable-sleep";

export type HealthDomainGroup = "energy" | "future_health";

export type HealthDomainKey =
  | "mind"
  | "rhythm_recovery"
  | "fitness"
  | "hormones"
  | "inflammation"
  | "cardiovascular"
  | "metabolic"
  | "brain"
  | "reproductive";

export type HealthDomainStatus = "good" | "attention" | "no_data";

export interface HealthDomainView {
  key: HealthDomainKey;
  group: HealthDomainGroup;
  label: string;
  /** One line describing what this domain covers — shown once as orientation. */
  blurb: string;
  status: HealthDomainStatus;
  /** Deterministic, template-built explanation — never model-phrased. */
  narrative: string;
}

export const HEALTH_DOMAIN_ORDER: readonly HealthDomainKey[] = [
  "mind",
  "rhythm_recovery",
  "fitness",
  "hormones",
  "inflammation",
  "cardiovascular",
  "metabolic",
  "brain",
  "reproductive",
];

const DOMAIN_META: Record<
  HealthDomainKey,
  { group: HealthDomainGroup; label: string; blurb: string }
> = {
  mind: {
    group: "energy",
    label: "Mind",
    blurb: "How clear-headed and steady you feel day to day.",
  },
  rhythm_recovery: {
    group: "energy",
    label: "Rhythm & recovery",
    blurb: "How well your sleep and rest are recharging you.",
  },
  fitness: {
    group: "energy",
    label: "Fitness",
    blurb: "Your everyday activity and physical resilience.",
  },
  hormones: {
    group: "energy",
    label: "Hormones",
    blurb: "Signals tied to hormonal balance.",
  },
  inflammation: {
    group: "energy",
    label: "Inflammation",
    blurb: "Signs of inflammation that could be draining your energy.",
  },
  cardiovascular: {
    group: "future_health",
    label: "Cardiovascular",
    blurb: "Your heart and circulation, over the long run.",
  },
  metabolic: {
    group: "future_health",
    label: "Metabolic",
    blurb: "Blood sugar and metabolic health.",
  },
  brain: {
    group: "future_health",
    label: "Brain",
    blurb: "Long-term memory, focus and cognitive health.",
  },
  reproductive: {
    group: "future_health",
    label: "Reproductive",
    blurb: "Reproductive health, tracked only with your consent.",
  },
};

/** Which existing patient_risk_scores.score_type feeds which domain. Any
 * score_type not listed here (e.g. predictive_missed_follow_up, an
 * adherence signal, not a body-system one) is deliberately left out of
 * this view — it stays visible via RiskSignalsCard instead.
 *
 * heart_rate_pattern lives under cardiovascular, not rhythm_recovery: it's
 * assess-heart-rate.ts's sustained resting-rate-range assessment, built to
 * mirror bp_control's own shape and raising the same category:"clinical"
 * alert — a cardiovascular signal, not a sleep/recovery one, even though
 * the name reads adjacent to "rhythm". */
const RISK_SCORE_TO_DOMAIN: Partial<Record<string, HealthDomainKey>> = {
  cvd_10yr: "cardiovascular",
  heart_age: "cardiovascular",
  bp_control: "cardiovascular",
  heart_rate_pattern: "cardiovascular",
  hba1c_trajectory: "metabolic",
};

/** Which existing biomarker category (lib/lab-reports/biomarker-categories.ts)
 * feeds which domain. kidney/liver are intentionally absent — see file header. */
const BIOMARKER_CATEGORY_TO_DOMAIN: Partial<
  Record<BiomarkerCategoryView["key"], HealthDomainKey>
> = {
  heart: "cardiovascular",
  blood_sugar: "metabolic",
};

function worse(a: HealthDomainStatus, b: HealthDomainStatus): HealthDomainStatus {
  if (a === "attention" || b === "attention") return "attention";
  if (a === "good" || b === "good") return "good";
  return "no_data";
}

export interface HealthDomainInputs {
  riskSignals?: readonly {
    score_type: string;
    risk_level: Enums<"risk_level"> | null;
  }[];
  biomarkerCategories?: readonly BiomarkerCategoryView[];
  sleepSummary?: SleepSummary | null;
  /** True only when the current viewer is the patient themself. Never
   * inferred for a caregiver/supporter viewing someone else's record —
   * reproductive_health must always be an explicit grant, never a default
   * (see private.can_read_clinical). Pass false whenever in doubt. */
  canViewReproductive?: boolean;
}

/** Pure — no I/O, fully testable without a DB or a query client. */
export function buildHealthDomains(inputs: HealthDomainInputs): HealthDomainView[] {
  const status = new Map<HealthDomainKey, HealthDomainStatus>(
    HEALTH_DOMAIN_ORDER.map((key) => [key, "no_data" as HealthDomainStatus])
  );
  const notes = new Map<HealthDomainKey, string[]>(
    HEALTH_DOMAIN_ORDER.map((key) => [key, [] as string[]])
  );

  for (const signal of inputs.riskSignals ?? []) {
    const domain = RISK_SCORE_TO_DOMAIN[signal.score_type];
    if (!domain) continue;
    if (signal.risk_level === "low") {
      status.set(domain, worse(status.get(domain)!, "good"));
    } else if (
      signal.risk_level === "moderate" ||
      signal.risk_level === "high" ||
      signal.risk_level === "very_high"
    ) {
      status.set(domain, worse(status.get(domain)!, "attention"));
    }
    // null / "unknown": no assertion either way — never fabricate a status.
  }

  for (const category of inputs.biomarkerCategories ?? []) {
    const domain = BIOMARKER_CATEGORY_TO_DOMAIN[category.key];
    if (!domain || category.status === null) continue;
    status.set(
      domain,
      worse(status.get(domain)!, category.status === "needs_attention" ? "attention" : "good")
    );
  }

  const sleep = inputs.sleepSummary;
  if (sleep && sleep.nightsInWindow > 0) {
    if (sleep.consistency === "irregular") {
      status.set("rhythm_recovery", worse(status.get("rhythm_recovery")!, "attention"));
    } else if (sleep.consistency === "consistent" || sleep.consistency === "somewhat_variable") {
      status.set("rhythm_recovery", worse(status.get("rhythm_recovery")!, "good"));
    }
    // consistency "unknown" (wearable-sleep.ts: fewer than 3 nights, "too
    // few nights to say anything meaningful") asserts no status either
    // way — same discipline as risk_level "unknown"/null above. The
    // average-hours sentence below is still a plain fact, not a verdict,
    // so it's fine to show even for those first couple of nights.
    if (sleep.averageMinutes != null) {
      const hours = Math.round((sleep.averageMinutes / 60) * 10) / 10;
      notes.get("rhythm_recovery")!.push(
        `You're averaging about ${hours} hours of sleep a night over your last ${sleep.nightsInWindow} synced night${sleep.nightsInWindow === 1 ? "" : "s"}` +
          (sleep.consistency === "irregular" ? ", with a fairly irregular pattern. " : ". ") +
          SLEEP_TREND_LABEL[sleep.trend]
      );
    }
  }

  return HEALTH_DOMAIN_ORDER.map((key) => {
    const meta = DOMAIN_META[key];
    const resolvedStatus =
      key === "reproductive" && inputs.canViewReproductive !== true ? "no_data" : status.get(key)!;
    const domainNotes = notes.get(key)!;
    const narrative =
      domainNotes.length > 0
        ? domainNotes.join(" ")
        : resolvedStatus === "no_data"
          ? "Nothing logged here yet."
          : resolvedStatus === "attention"
            ? "Something here is getting extra attention from your care team."
            : "Everything here looks steady.";
    return {
      key,
      group: meta.group,
      label: meta.label,
      blurb: meta.blurb,
      status: resolvedStatus,
      narrative,
    };
  });
}

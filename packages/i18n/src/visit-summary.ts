import { t, type Locale, type MessageKey } from "./translate";

/**
 * AVS (after-visit summary): pure helpers shared by the web app, the mobile app and the tests.
 * No model, no network. The urgent-care wording is NOT written here: it is the existing signed key below.
 */

/** The existing emergency guidance every summary shows. A test pins its text so it cannot be edited away unnoticed. */
export const AVS_URGENT_KEY = "history.unwell" satisfies MessageKey;

export type AvsItemKind = "medicine" | "lab" | "referral" | "plan_change" | "recheck" | "follow_up" | "custom";
export const AVS_ITEM_KINDS: readonly AvsItemKind[] = ["medicine", "lab", "referral", "plan_change", "recheck", "follow_up", "custom"];

export type AvsState = "draft" | "approved" | "withdrawn";

export const AVS_STATE_KEYS: Readonly<Record<AvsState, MessageKey>> = {
  draft: "avs.review.state.draft",
  approved: "avs.review.state.approved",
  withdrawn: "avs.review.state.withdrawn",
};

export interface AvsItemLike {
  readonly kind: string;
  readonly params?: Readonly<Record<string, unknown>> | null;
  readonly customText?: string | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * The label for one checklist item: the clinician's own words if they wrote any, otherwise the catalogue sentence for its kind.
 * Medicine and care plan items add the plain values the clinician saw when they signed (name, dose, how often).
 */
export function avsItemLabel(item: AvsItemLike, locale: Locale): string {
  const custom = str(item.customText);
  if (custom) return custom;
  const p = item.params ?? {};
  switch (item.kind) {
    case "medicine": {
      const detail = [str(p.drug_name), str(p.dose), str(p.frequency)].filter(Boolean).join(" ");
      return detail ? t("avs.item.medicine_named", locale, { detail }) : t("avs.item.medicine", locale);
    }
    case "plan_change": {
      const detail = str(p.summary);
      return detail ? t("avs.item.plan_change", locale, { detail }) : t("avs.item.plan_change_plain", locale);
    }
    case "lab":
      return t("avs.item.lab", locale);
    case "referral":
      return t("avs.item.referral", locale);
    case "recheck":
      return t("avs.item.recheck", locale);
    case "follow_up":
      return t("avs.item.follow_up", locale);
    default:
      return t("avs.item.custom", locale);
  }
}

/** Mirror of private.visit_summary_copy_problems in the database. The database is the floor; this gives the same answer earlier. */
export type AvsCopyProblem = "dash" | "warning" | "your_doctor" | "cure" | "instant_doctor" | "free_healthcare";

const PROBLEM_RULES: readonly (readonly [AvsCopyProblem, RegExp])[] = [
  ["dash", /[—–]/],
  ["warning", /\bwarning\b/i],
  ["your_doctor", /\byour doctor\b/i],
  ["cure", /\bcures?d?\b/i],
  ["instant_doctor", /instant doctor/i],
  ["free_healthcare", /free healthcare/i],
];

export function avsCopyProblems(text: string): AvsCopyProblem[] {
  return PROBLEM_RULES.filter(([, re]) => re.test(text)).map(([code]) => code);
}

export const AVS_PROBLEM_KEYS: Readonly<Record<AvsCopyProblem, MessageKey>> = {
  dash: "avs.review.problem.dash",
  warning: "avs.review.problem.warning",
  your_doctor: "avs.review.problem.your_doctor",
  cure: "avs.review.problem.cure",
  instant_doctor: "avs.review.problem.instant_doctor",
  free_healthcare: "avs.review.problem.free_healthcare",
};

/** Advice only (never blocks): sentences of more than 25 words are hard to read on a small screen. */
export const AVS_MAX_SENTENCE_WORDS = 25;
export function avsLongSentenceCount(text: string): number {
  return text
    .split(/[.!?\n]+/)
    .map((s) => s.trim().split(/\s+/).filter(Boolean).length)
    .filter((n) => n > AVS_MAX_SENTENCE_WORDS).length;
}

/** The stored summary text is bounded in the database; the editor uses the same numbers. */
export const AVS_TEXT_MIN = 20;
export const AVS_TEXT_MAX = 4000;
export const AVS_ITEM_TEXT_MAX = 400;

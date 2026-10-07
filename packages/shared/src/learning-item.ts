/**
 * Learning Centre item rules shared by web and mobile (S55, spec 9.4, 9.6, 9.8). Pure functions, no I/O.
 *
 * The reviewer credit is null-gated, the same discipline as ReviewedByDoctor: it exists only when the database returned a
 * reviewer name AND a review date for an item marked clinician reviewed. Never a hard-coded or implied credit.
 */

export interface LearningItemFields {
  clinician_reviewed?: boolean | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  source_reference?: string | null;
  next_review_due?: string | null;
  next_action?: string | null;
  next_step_kind?: string | null;
  next_step_target_code?: string | null;
  next_step_target_title?: string | null;
}

export interface ReviewCredit {
  reviewer: string;
  /** ISO timestamp as returned by the database. */
  reviewedAt: string;
  sources: string[];
  /** Date (YYYY-MM-DD) the item is next due for review, when set. */
  nextReviewDue: string | null;
}

export function splitSources(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n|;/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function reviewCredit(item: LearningItemFields): ReviewCredit | null {
  if (!item.clinician_reviewed) return null;
  const reviewer = item.reviewed_by_name?.trim();
  if (!reviewer || !item.reviewed_at) return null;
  return {
    reviewer,
    reviewedAt: item.reviewed_at,
    sources: splitSources(item.source_reference),
    nextReviewDue: item.next_review_due ?? null,
  };
}

/** "7 Oct 2026" in Africa/Lagos, never the phone's own zone. */
export function formatLagosDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }).format(d);
}

export type NextStepKind = "care_plan_goal" | "booking" | "lesson";

export interface NextStep {
  /** Null when the item has the sentence but no link target: the footer is then text only. */
  kind: NextStepKind | null;
  /** The sentence shown to the patient. */
  label: string;
  /** Content code of the next lesson, when kind is lesson and that lesson is still servable. */
  targetCode: string | null;
  targetTitle: string | null;
}

const KINDS: readonly string[] = ["care_plan_goal", "booking", "lesson"];

/**
 * The standard "What can I do next?" footer. Null when the item has no next-step sentence (older items published before the rule).
 * A missing or unknown kind gives a text-only footer.
 * A lesson link is dropped, with the sentence kept, when the target is not currently servable (the database then returns no
 * target title).
 */
export function nextStep(item: LearningItemFields): NextStep | null {
  const label = item.next_action?.trim();
  if (!label) return null;
  const kind = item.next_step_kind && KINDS.includes(item.next_step_kind) ? (item.next_step_kind as NextStepKind) : null;
  const linkable = kind === "lesson" && !!item.next_step_target_code && !!item.next_step_target_title;
  return {
    kind,
    label,
    targetCode: linkable ? (item.next_step_target_code ?? null) : null,
    targetTitle: linkable ? (item.next_step_target_title ?? null) : null,
  };
}

/** Lagos calendar date (YYYY-MM-DD) for an instant. */
export function lagosDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Africa/Lagos" }).format(now);
}

/**
 * True when an item must no longer be shown: its review date is today or earlier in Lagos. Mirrors
 * private.health_education_review_in_date (no date means not expired, because nothing has passed).
 */
export function reviewExpired(nextReviewDue: string | null | undefined, now: Date = new Date()): boolean {
  if (!nextReviewDue) return false;
  return nextReviewDue <= lagosDate(now);
}

export interface DownloadedItemRef {
  code: string;
}

/**
 * Offline re-check on sync (9.6). `servable` is what health_education_servable_codes returned for the downloaded codes. Anything
 * not returned is removed from the phone: expired, withdrawn, or locked for this person.
 */
export function offlineSyncPlan<T extends DownloadedItemRef>(downloaded: readonly T[], servable: readonly { code: string }[]): { keep: T[]; drop: T[] } {
  const ok = new Set(servable.map((s) => s.code));
  return { keep: downloaded.filter((d) => ok.has(d.code)), drop: downloaded.filter((d) => !ok.has(d.code)) };
}

/** Local expiry check used when the phone is offline: hides a cached item whose review date has passed. */
export function offlineVisible<T extends { next_review_due?: string | null }>(items: readonly T[], now: Date = new Date()): T[] {
  return items.filter((i) => !reviewExpired(i.next_review_due, now));
}

/** Link to the public share page. Only the content code goes in the URL: no patient data, ever. */
export function publicShareUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/health-library/${encodeURIComponent(code)}`;
}

export function shareByEmailUrl(title: string, url: string): string {
  const subject = encodeURIComponent(title);
  const body = encodeURIComponent(`I thought this might help: ${title}\n\n${url}`);
  return `mailto:?subject=${subject}&body=${body}`;
}

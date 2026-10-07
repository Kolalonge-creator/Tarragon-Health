// S17: who may be offered which task, in what order, and the small calculations around a claim (spec 7.6, 7.8).
//
// Pure: no clock of its own (callers pass `now`), no database. The database is the enforcer
// (public.queue_next and private.queue_candidates); this is the same rules for tests and for any screen that has to
// decide before it asks. A shared table of cases (packages/queue/fixtures/eligibility-cases.json) is run through
// this file in Jest and through the SQL in the database proof, so the two cannot drift.

import { meetsMinimumTier, type DoctorTier } from "./state-machine.ts";

/** Whether `have` is at or above `need` (the same ladder the database uses in private.doctor_tier_rank). */
export function tierAtLeast(have: DoctorTier, need: DoctorTier): boolean {
  return meetsMinimumTier(have, need);
}

export const HANDBACK_REASONS = ["conflict_of_interest", "outside_competence", "needs_information", "technical_problem", "other"] as const;
export type HandbackReason = (typeof HANDBACK_REASONS)[number];

export type OfferedTo = "me" | "other" | "none";
export type ClaimableState = "open" | "offered_to_lead" | "escalated";

export interface ClinicianFacts {
  tier: DoctorTier;
  competencies: readonly string[];
  employed: boolean;
  hasBlock: boolean;
  isTest: boolean;
  conflicted: boolean;
  handedBack: boolean;
  ownPatient: boolean;
}

export interface TaskFacts {
  state: ClaimableState;
  minTier: DoctorTier;
  requiredCompetencies: readonly string[];
  offeredTo: OfferedTo;
  isTest: boolean;
}

export interface ClaimRules {
  escalatedRequiresOnCall: boolean;
}

/** Whether queue_next could hand this task to this clinician (the gate checks aside: licence, cooling-off, cap). */
export function mayBeOffered(c: ClinicianFacts, t: TaskFacts, rules: ClaimRules): boolean {
  // pulling from the pool needs a declared queue block; an employed doctor may still take work pushed to them
  const offeredToMe = t.state === "offered_to_lead" && t.offeredTo === "me";
  if (!c.hasBlock && !(c.employed && offeredToMe)) return false;
  if (c.isTest !== t.isTest) return false;
  if (c.ownPatient || c.conflicted || c.handedBack) return false;
  if (!tierAtLeast(c.tier, t.minTier)) return false;
  if (!t.requiredCompetencies.every((k) => c.competencies.includes(k))) return false;
  if (t.state === "offered_to_lead") return t.offeredTo === "me";
  if (t.state === "escalated") return !rules.escalatedRequiresOnCall || c.competencies.includes("on_call");
  return true;
}

export interface OrderableTask {
  id: string;
  priorityClass: number;
  state: ClaimableState;
  dueAt: number;
  createdAt: number;
}

/** Spec 7.6 order: class, then due time, then age. A task offered to this clinician goes ahead of a pool task of the same class. */
export function orderTasks<T extends OrderableTask>(tasks: readonly T[]): T[] {
  return [...tasks].sort(
    (a, b) =>
      a.priorityClass - b.priorityClass ||
      Number(a.state !== "offered_to_lead") - Number(b.state !== "offered_to_lead") ||
      a.dueAt - b.dueAt ||
      a.createdAt - b.createdAt,
  );
}

export function claimExpiresAt(claimedAt: number, timeoutMinutes: number): number {
  return claimedAt + timeoutMinutes * 60_000;
}

export type HandbackCheck = { ok: true } | { ok: false; error: "queue_bad_reason" | "queue_note_needed" };

export function validateHandback(reason: string, note: string | null | undefined): HandbackCheck {
  if (!(HANDBACK_REASONS as readonly string[]).includes(reason)) return { ok: false, error: "queue_bad_reason" };
  if (reason === "other" && (note ?? "").trim().length < 10) return { ok: false, error: "queue_note_needed" };
  return { ok: true };
}

export interface HandbackReviewRule {
  moreThan: number;
}

/** More than the threshold in the window goes to the clinical lead. It informs a person; it never suspends anyone. */
export function handbackNeedsReview(countInWindow: number, rule: HandbackReviewRule): boolean {
  return countInWindow > rule.moreThan;
}

export interface CooldownRule {
  count: number;
  windowMinutes: number;
  exemptReasons: readonly string[];
  hardCount: number;
  hardWindowMinutes: number;
}

export interface RecentHandback {
  reason: string;
  at: number;
}

/** A clinician who hands back several tasks in a few minutes is cooled off, so hand-back cannot be used to re-roll the queue. */
export function inCooldown(recent: readonly RecentHandback[], now: number, rule: CooldownRule): boolean {
  const since = now - rule.windowMinutes * 60_000;
  const hardSince = now - rule.hardWindowMinutes * 60_000;
  return (
    recent.filter((h) => h.at > since && !rule.exemptReasons.includes(h.reason)).length >= rule.count ||
    recent.filter((h) => h.at > hardSince).length >= rule.hardCount
  );
}

/** Only some reasons bar the clinician from being offered the same task again; a dropped connection does not. */
export function handbackExcludesTask(reason: string, excludingReasons: readonly string[]): boolean {
  return excludingReasons.includes(reason);
}

export type ReliabilityKind = "completed_on_time" | "completed_late" | "claim_expired" | "handed_back_other" | "handed_back_reasoned" | "audit_result";

export interface ReliabilityRules {
  windowDays: number;
  halfLifeDays: number;
  priorEvents: number;
  priorGood: number;
  weights: Record<string, number>;
  good: Record<string, number>;
}

export interface ReliabilityEvent {
  kind: ReliabilityKind;
  weight: number;
  good: number;
  at: number;
}

export function reliabilityKindForHandback(reason: HandbackReason): "handed_back_other" | "handed_back_reasoned" {
  return reason === "other" ? "handed_back_other" : "handed_back_reasoned";
}

export function reliabilityKindForCompletion(now: number, dueAt: number): "completed_on_time" | "completed_late" {
  return now <= dueAt ? "completed_on_time" : "completed_late";
}

/** The event as written: weight and "good" are fixed at write time from the config in force (history is never rewritten). */
export function makeReliabilityEvent(kind: ReliabilityKind, at: number, rules: ReliabilityRules): ReliabilityEvent {
  return { kind, at, weight: rules.weights[kind] ?? 0, good: rules.good[kind] ?? 0 };
}

/**
 * 0 to 100. A new clinician starts at the prior (80). Each event counts by its weight, fading with a half-life, so a
 * handful of events cannot swing the score and old ones fade. Reasoned hand-backs weigh zero.
 */
export function reliabilityScore(events: readonly ReliabilityEvent[], now: number, rules: ReliabilityRules): number {
  const windowStart = now - rules.windowDays * 86_400_000;
  let sw = 0;
  let sg = 0;
  for (const e of events) {
    if (e.at <= windowStart) continue;
    const decay = Math.exp((-Math.LN2 * (now - e.at)) / 86_400_000 / rules.halfLifeDays);
    sw += e.weight * decay;
    sg += e.weight * e.good * decay;
  }
  return Math.round((100 * (rules.priorEvents * rules.priorGood + sg)) / (rules.priorEvents + sw) * 100) / 100;
}

const ERROR_STATUS: Record<string, number> = {
  queue_not_clinician: 403,
  queue_not_eligible: 403,
  queue_no_tier: 403,
  queue_no_availability: 409,
  queue_cooling_off: 429,
  queue_no_claim: 409,
  queue_claim_expired: 409,
  queue_extension_used: 409,
  queue_bad_reason: 422,
  queue_note_needed: 422,
};

/** Maps a database error message to an HTTP status and a stable code. Anything unknown is a 500 with no detail. */
export function mapQueueError(message: string): { status: number; code: string } {
  const code = String(message.trim().split(/\s/)[0]);
  const status = ERROR_STATUS[code];
  return status === undefined ? { status: 500, code: "queue_failed" } : { status, code };
}

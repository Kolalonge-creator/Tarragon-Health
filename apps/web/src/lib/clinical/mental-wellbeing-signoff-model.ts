import { createHash } from "node:crypto";
import { en } from "@tarragon/i18n";
import type { GuardStatus } from "@/lib/go-live/model";

/**
 * The CMO's sign-off for the S56b wellbeing features (pure, so it is tested without a database).
 *
 * Four guards, all born off, each with the conditions a person must record before the CMO may switch it on:
 *   mental_health_worklist_enabled    rules signed (data) + clinician cover (attestation)
 *   wellbeing_summary_share_enabled   cover to read shared summaries (attestation)
 *   panic_tool_enabled                the exact wording (attestation bound to a fingerprint) + tried with a screen reader and reduced motion (attestation)
 *   mood_insights_enabled             the exact sentence templates (attestation bound to a fingerprint)
 * Nothing here signs, attests or switches anything; it only decides what the hub shows.
 */
export const MENTAL_WELLBEING_ITEM_KEY = "mental_wellbeing_s56b";

export const WORKLIST_GUARD = "mental_health_worklist_enabled";
export const SHARE_GUARD = "wellbeing_summary_share_enabled";
export const PANIC_GUARD = "panic_tool_enabled";
export const INSIGHTS_GUARD = "mood_insights_enabled";

export interface AttestationSlot {
  readonly guard: string;
  readonly code: string;
  readonly title: string;
  readonly intro: string;
  /** The wording set whose exact text the attestation is bound to (the note must carry the fingerprint). */
  readonly wordingSet?: WordingSet;
}

/** Which catalogue prefixes each fingerprint covers. The database holds one fingerprint per set (private.s56b_*_fingerprint). */
export const FINGERPRINT_SETS = {
  panic: ["panic."],
  // the four sentence templates, the weekday names they use and the tag labels they print
  insights: ["insights.", "mood.tag."],
  share: ["wsum."],
  worklist: ["wnotice."],
} as const;
export type WordingSet = keyof typeof FINGERPRINT_SETS;

export const ATTESTATION_SLOTS: readonly AttestationSlot[] = [
  { guard: WORKLIST_GUARD, code: "worklist_cover_confirmed", title: "Mental health follow-ups: clinician cover", intro: "Record that a named clinician or team will pick up the follow-up tasks this list creates, within the time the rules state." },
  { guard: WORKLIST_GUARD, code: "worklist_notice_wording_signed", title: "Mental health follow-ups: the sentence patients read", intro: "Read the sentence below. It tells patients what the list uses and offers them an opt-out for check-in activity and the sleep diary. This attestation is tied to a fingerprint of these exact words.", wordingSet: "worklist" },
  { guard: SHARE_GUARD, code: "share_wording_signed", title: "Share with my care team: the exact words", intro: "Read every line of the share screen below. This attestation is tied to a fingerprint of these exact words.", wordingSet: "share" },
  { guard: SHARE_GUARD, code: "share_cover_confirmed", title: "Share with my care team: cover to read summaries", intro: "Record that a clinician will read a summary a patient chooses to send within a working day." },
  { guard: PANIC_GUARD, code: "panic_wording_signed", title: "Calm tool: the exact wording", intro: "Read every line below. This attestation is tied to a fingerprint of these exact words: if one word changes, it stops counting until you attest the new text.", wordingSet: "panic" },
  { guard: PANIC_GUARD, code: "panic_accessibility_checked", title: "Calm tool: tried with a screen reader and reduced motion", intro: "Record that someone has used the calm tool on a real phone with a screen reader on and with reduced motion on, and it worked." },
  { guard: INSIGHTS_GUARD, code: "insights_wording_signed", title: "Patterns view: the sentence templates", intro: "Read the four sentences below. The view only ever fills in counts from the patient's own entries. This attestation is tied to a fingerprint of these exact words.", wordingSet: "insights" },
];

/** First 12 hex characters of the SHA-256 of "key=value\n" for every key with the prefix, sorted. The database holds the same value. */
export function wordingFingerprint(set: WordingSet, catalogue: Record<string, string> = en as Record<string, string>): string {
  const keys = Object.keys(catalogue).filter((k) => FINGERPRINT_SETS[set].some((x) => k.startsWith(x))).sort();
  return createHash("sha256").update(keys.map((k) => `${k}=${catalogue[k]}\n`).join("")).digest("hex").slice(0, 12);
}

export function wordingLines(set: WordingSet, catalogue: Record<string, string> = en as Record<string, string>): { key: string; text: string }[] {
  return Object.keys(catalogue).filter((k) => FINGERPRINT_SETS[set].some((x) => k.startsWith(x))).sort().map((key) => ({ key, text: catalogue[key] as string }));
}

/** The attestation slots whose condition is not yet met, read from the guard status (an unknown condition is not shown as pending). */
export function pendingAttestations(guards: readonly GuardStatus[]): AttestationSlot[] {
  return ATTESTATION_SLOTS.filter((slot) => guards.find((g) => g.key === slot.guard)?.conditions.find((c) => c.code === slot.code)?.met === false);
}

export interface WorklistRulesView {
  readonly lines: readonly string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (o: unknown, k: string): number | null => (isObj(o) && typeof o[k] === "number" ? (o[k] as number) : null);
const on = (o: unknown): boolean => isObj(o) && o.enabled === true;

/** The draft rules in plain words, read from the draft itself so the words the CMO signs are the values that will apply. Null when anything is missing. */
export function worklistRulesView(rules: unknown): WorklistRulesView | null {
  if (!isObj(rules)) return null;
  const rs = rules.rising_screen, os = rules.overdue_screen, st = rules.sleep_trouble, mc = rules.missed_checkins, uh = rules.unactioned_handoff, fu = rules.follow_up;
  const need = [num(rs, "look_back_days"), num(rs, "phq9_min_rise"), num(rs, "gad7_min_rise"), num(os, "grace_days"), num(st, "window_days"), num(st, "min_entries"),
    num(st, "min_trouble_nights"), num(st, "low_quality_at_or_below"), num(st, "short_sleep_hours"), num(mc, "prior_window_days"), num(mc, "min_prior_checkins"), num(mc, "silent_days"),
    num(uh, "after_hours"), num(fu, "task_due_minutes"), num(fu, "snooze_days"), num(rules, "max_rows"), num(rules, "count_cache_minutes")];
  if (need.some((n) => n === null)) return null;
  const lines: string[] = [];
  lines.push(on(rs) ? `A PHQ-9 that rose by ${num(rs, "phq9_min_rise")} or more, or a GAD-7 that rose by ${num(rs, "gad7_min_rise")} or more, between the two latest screens within ${num(rs, "look_back_days")} days.` : "Rising scores: switched off.");
  lines.push(on(os) ? `A PHQ-9 or GAD-7 that is more than ${num(os, "grace_days")} days past the date the screening schedule set. This rule works only while the screening schedule is signed.` : "Overdue screens: switched off.");
  lines.push(on(st) ? `A sleep diary with at least ${num(st, "min_entries")} nights in the last ${num(st, "window_days")} days, ${num(st, "min_trouble_nights")} or more of them under ${num(st, "short_sleep_hours")} hours or rated ${num(st, "low_quality_at_or_below")} out of 5 or lower.` : "Sleep trouble: switched off.");
  // The check-ins-stopped rule is not in the first draft (founder decision, OQ-S56b-03), so it is not listed while it is off.
  if (on(mc)) lines.push(`${num(mc, "min_prior_checkins")} or more mood check-ins in the ${num(mc, "prior_window_days")} days before, then none for ${num(mc, "silent_days")} days.`);
  lines.push(on(uh) ? `A hand-off, summary or request to talk that nobody has marked seen for ${num(uh, "after_hours")} hours.` : "Waiting hand-offs: switched off.");
  lines.push(`A follow-up made from the list is a task due in ${Math.round((num(fu, "task_due_minutes") as number) / 60)} hours; the patient stays on the list, marked, for ${num(fu, "snooze_days")} days. At most ${num(rules, "max_rows")} patients are shown.`);
  return { lines };
}

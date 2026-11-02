/**
 * Display model for the admin home (docs/design/DASHBOARD-PROGRAMME-CLINICIAN-FIRST.md, "next dashboard" template).
 *
 * Pure functions, no I/O. The page fetches and decides who may see what; this decides what to put first and, above all,
 * refuses to turn a read that failed into an all-clear. It reuses the clinician home's `Figure`: a count is known or it is unknown,
 * never a zero that came out of an error.
 */

import type { Figure } from "./clinician-home";

export interface AttentionItem {
  /** Stable key, also the tie-break order (lower index in ATTENTION_PRIORITY ranks first). */
  readonly key: AttentionKey;
  readonly label: (count: number) => string;
  readonly href: string;
  readonly count: Figure;
}

/** Most urgent first: a serious incident, then clinical-safety sign-off, then people waiting on a decision. */
export const ATTENTION_PRIORITY = ["serious_incidents", "ai_governance", "front_desk_signoff", "clinician_verification", "booking_requests"] as const;
export type AttentionKey = (typeof ATTENTION_PRIORITY)[number];

export interface ResolvedAttention {
  readonly key: AttentionKey;
  readonly text: string;
  readonly href: string;
  readonly count: number;
}

export type AttentionView =
  /** Every item the caller can see failed to load: say so, never "caught up". */
  | { kind: "unknown"; unknown: readonly { key: AttentionKey; href: string }[] }
  /** Everything loaded and nothing is waiting. */
  | { kind: "clear" }
  /** Something is waiting. `unknown` lists any item that could not be read, so the list is never presented as complete when it is not. */
  | { kind: "action"; top: ResolvedAttention; rest: readonly ResolvedAttention[]; unknown: readonly { key: AttentionKey; href: string }[] };

export function attentionView(items: readonly AttentionItem[]): AttentionView {
  const known: ResolvedAttention[] = [];
  const unknown: { key: AttentionKey; href: string }[] = [];
  for (const item of items) {
    if (item.count.state === "unknown") unknown.push({ key: item.key, href: item.href });
    else if (item.count.value > 0) known.push({ key: item.key, text: item.label(item.count.value), href: item.href, count: item.count.value });
  }
  known.sort((a, b) => ATTENTION_PRIORITY.indexOf(a.key) - ATTENTION_PRIORITY.indexOf(b.key));
  const [top, ...rest] = known;
  if (top) return { kind: "action", top, rest, unknown };
  if (unknown.length > 0) return { kind: "unknown", unknown };
  return { kind: "clear" };
}

export type DependencyStatus = "up" | "configured" | "down" | "unconfigured" | "not_deployed" | string;

/** The dependencies reported down. "unconfigured" and "not_deployed" are not faults: a provider nobody has set up yet is not an outage. */
export function dependenciesDown(report: object): string[] {
  // The report also carries non-dependency fields (a `checked_at` timestamp); only entries shaped { status } count.
  return Object.entries(report)
    .filter(([, v]) => typeof v === "object" && v !== null && (v as { status?: DependencyStatus }).status === "down")
    .map(([k]) => k);
}

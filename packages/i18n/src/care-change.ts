/**
 * S24: the patient's side of a signed care plan change. One implementation for web and mobile.
 * Pure: no clock, no I/O. Parses what `my_care_plan_changes()` returns, builds the plain before and after
 * sentences, and maps the RPC outcome to a message. Never prints "undefined" or a null name, and never reads a
 * clinical rationale (the RPC does not return one).
 */
import type { MessageKey } from "./en";
import type { MessageParams } from "./index";

export type Translate = (key: MessageKey, params?: MessageParams) => string;

export type CareChangeKind = "medication" | "target" | "reading_schedule";
export type CareChangeState = "signed" | "confirmed" | "declined" | "expired";

export interface CareChange {
  id: string;
  kind: CareChangeKind;
  state: CareChangeState;
  summary: string | null;
  proposal: Record<string, unknown>;
  before: Record<string, unknown>;
  signedAt: string | null;
  expiresAt: string | null;
  signedByName: string | null;
  confirmedAt: string | null;
  declinedAt: string | null;
}

const KINDS: readonly CareChangeKind[] = ["medication", "target", "reading_schedule"];
const STATES: readonly CareChangeState[] = ["signed", "confirmed", "declined", "expired"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown): string | null {
  if (typeof v === "string") {
    const s = v.trim();
    return s.length > 0 && s !== "undefined" && s !== "null" ? s : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Rows that do not look right are dropped, never shown half-filled. */
export function parseCareChanges(raw: unknown): CareChange[] {
  if (!Array.isArray(raw)) return [];
  const out: CareChange[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = text(item.id);
    const kind = KINDS.find((k) => k === item.kind);
    const state = STATES.find((s) => s === item.state);
    if (!id || !kind || !state) continue;
    out.push({
      id,
      kind,
      state,
      summary: text(item.summary),
      proposal: isRecord(item.proposal) ? item.proposal : {},
      before: isRecord(item.before) ? item.before : {},
      signedAt: text(item.signed_at),
      expiresAt: text(item.expires_at),
      signedByName: text(item.signed_by_name),
      confirmedAt: text(item.confirmed_at),
      declinedAt: text(item.declined_at),
    });
  }
  return out;
}

/** The changes waiting for an answer, and the rest, for the small history list. */
export function splitCareChanges(changes: readonly CareChange[]): { waiting: CareChange[]; history: CareChange[] } {
  return {
    waiting: changes.filter((c) => c.state === "signed"),
    history: changes.filter((c) => c.state !== "signed"),
  };
}

/** "Dolo, 500 mg, twice a day, by mouth, for 5 days". Missing parts are left out; nothing at all reads "this medicine". */
export function describeMedicine(item: unknown, tr: Translate): string {
  const o = isRecord(item) ? item : {};
  const name = text(o.drug_name);
  const parts = [name, text(o.dose), text(o.frequency), text(o.route)].filter((p): p is string => p !== null);
  const days = typeof o.duration_days === "number" && Number.isFinite(o.duration_days) && o.duration_days > 0 ? o.duration_days : null;
  if (days !== null) parts.push(tr("careChange.forDays", { days }));
  if (parts.length === 0) return tr("careChange.thisMedicine");
  return parts.join(", ");
}

function humanise(key: string): string {
  const s = key.split("_").join(" ").trim();
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : key;
}

function valueText(v: unknown): string | null {
  const simple = text(v);
  if (simple !== null) return simple;
  if (Array.isArray(v)) {
    const parts = v.map(valueText).filter((p): p is string => p !== null);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (isRecord(v)) {
    const min = text(v.min);
    const max = text(v.max);
    if (min !== null && max !== null) return `${min} to ${max}`;
    if (max !== null) return `up to ${max}`;
    if (min !== null) return `at least ${min}`;
    const parts = Object.entries(v)
      .map(([k, x]) => {
        const vt = valueText(x);
        return vt === null ? null : `${humanise(k)}: ${vt}`;
      })
      .filter((p): p is string => p !== null);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
}

/** An object of numbers or settings as one plain line ("Blood pressure: 130 to 80"). Empty gives null. */
export function describeSettings(obj: unknown): string | null {
  if (!isRecord(obj)) return null;
  const parts = Object.entries(obj)
    .map(([k, v]) => {
      const vt = valueText(v);
      return vt === null ? null : `${humanise(k)}: ${vt}`;
    })
    .filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join("; ") : null;
}

export interface ChangeSentences {
  heading: string;
  /** null when there is nothing to compare (a new medicine). */
  before: string | null;
  after: string | null;
}

export function buildChangeSentences(change: Pick<CareChange, "kind" | "proposal" | "before">, tr: Translate): ChangeSentences {
  const { kind, proposal, before } = change;
  if (kind === "medication") {
    const action = proposal.action;
    const item = proposal.item;
    if (action === "start") {
      return { heading: tr("careChange.heading.start"), before: null, after: describeMedicine(item, tr) };
    }
    if (action === "change") {
      return { heading: tr("careChange.heading.change"), before: describeMedicine(before, tr), after: describeMedicine(item, tr) };
    }
    if (action === "stop") {
      return { heading: tr("careChange.heading.stop"), before: describeMedicine(before, tr), after: tr("careChange.stopNow") };
    }
    return { heading: tr("careChange.heading.other"), before: null, after: null };
  }
  if (kind === "target") {
    return {
      heading: tr("careChange.heading.target"),
      before: describeSettings(before.target_ranges) ?? tr("careChange.nothingSet"),
      after: describeSettings(proposal.target_ranges),
    };
  }
  return {
    heading: tr("careChange.heading.schedule"),
    before: describeSettings(before.reading_schedule) ?? tr("careChange.nothingSet"),
    after: describeSettings(proposal.reading_schedule),
  };
}

/** The "who signed and when" line. A null name is never printed: it says "your care team" instead. */
export function signedLine(change: Pick<CareChange, "signedByName" | "signedAt">, formatDate: (iso: string) => string, tr: Translate): string | null {
  if (!change.signedAt) return null;
  const date = formatDate(change.signedAt);
  return change.signedByName
    ? tr("careChange.signedBy", { name: change.signedByName, date })
    : tr("careChange.signedByTeam", { date });
}

/** One line for the small history list. */
export function historyLine(change: CareChange, formatDate: (iso: string) => string, tr: Translate): string | null {
  const heading = buildChangeSentences(change, tr).heading;
  const when =
    change.state === "confirmed" ? change.confirmedAt : change.state === "declined" ? change.declinedAt : change.state === "expired" ? change.expiresAt : null;
  if (!when) return null;
  const key: MessageKey =
    change.state === "confirmed" ? "careChange.history.confirmed" : change.state === "declined" ? "careChange.history.declined" : "careChange.history.expired";
  return `${heading}. ${tr(key, { date: formatDate(when) })}`;
}

export type ConfirmOutcome = "applied" | "expired" | "needs_review" | "not_available" | "error";

const OUTCOMES: readonly ConfirmOutcome[] = ["applied", "expired", "needs_review", "not_available"];

/** Reads `{ outcome }` from the confirm RPC. Anything unreadable is "error": never treated as applied. */
export function parseConfirmOutcome(raw: unknown): ConfirmOutcome {
  if (!isRecord(raw)) return "error";
  return OUTCOMES.find((o) => o === raw.outcome) ?? "error";
}

export function outcomeMessageKey(outcome: ConfirmOutcome, kind: CareChangeKind, app = false): MessageKey {
  switch (outcome) {
    case "applied":
      return kind === "medication"
        ? app
          ? "careChange.outcome.applied.medicine.app"
          : "careChange.outcome.applied.medicine"
        : "careChange.outcome.applied.plan";
    case "expired":
      return "careChange.outcome.expired";
    case "needs_review":
      return "careChange.outcome.needs_review";
    case "not_available":
      return "careChange.outcome.not_available";
    default:
      return "careChange.outcome.error";
  }
}

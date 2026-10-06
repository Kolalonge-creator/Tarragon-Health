/**
 * S24: what the clinician panel reads from list_care_plan_changes, parsed defensively and put into plain words. Pure (no clock, no I/O).
 * A row that does not look right is dropped rather than shown half-filled, and nothing here prints "undefined" or "null".
 */

import { TITRATION_STOP_KEYS } from "@tarragon/clinical/titration";
import { t, type MessageKey } from "@tarragon/i18n";

export type ChangeKind = "medication" | "target" | "reading_schedule";
export type ChangeState = "proposed" | "signed" | "rejected" | "confirmed" | "declined" | "expired";

export interface StaffCareChange {
  id: string;
  kind: ChangeKind;
  state: ChangeState;
  proposedBy: "engine" | "clinician";
  proposedByName: string | null;
  proposal: Record<string, unknown>;
  before: Record<string, unknown> | null;
  rationale: string;
  patientSummary: string | null;
  protocolVersion: number | null;
  engineInputs: Record<string, unknown> | null;
  safetyChecks: Record<string, unknown> | null;
  signedByName: string | null;
  signedAt: string | null;
  expiresAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  patientConfirmedAt: string | null;
  patientDeclinedAt: string | null;
  declineReason: string | null;
  expiredAt: string | null;
  appliedAt: string | null;
  createdAt: string | null;
  carePlanId: string | null;
}

const KINDS: readonly ChangeKind[] = ["medication", "target", "reading_schedule"];
const STATES: readonly ChangeState[] = ["proposed", "signed", "rejected", "confirmed", "declined", "expired"];

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

/** `names` maps a profile id to a staff name (best effort); an unknown id never prints as an id. */
export function parseStaffCareChanges(raw: unknown, names: Record<string, string> = {}): StaffCareChange[] {
  if (!Array.isArray(raw)) return [];
  const out: StaffCareChange[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = text(item.id);
    const kind = KINDS.find((k) => k === item.kind);
    const state = STATES.find((s) => s === item.state);
    if (!id || !kind || !state || !isRecord(item.proposal)) continue;
    const signedBy = text(item.signed_by);
    const proposedByUser = text(item.proposed_by_user);
    out.push({
      id,
      kind,
      state,
      proposedBy: item.proposed_by === "engine" ? "engine" : "clinician",
      proposedByName: proposedByUser ? (names[proposedByUser] ?? null) : null,
      proposal: item.proposal,
      before: isRecord(item.before) ? item.before : null,
      rationale: text(item.rationale) ?? "",
      patientSummary: text(item.patient_summary),
      protocolVersion: typeof item.protocol_version === "number" ? item.protocol_version : null,
      engineInputs: isRecord(item.engine_inputs) ? item.engine_inputs : null,
      safetyChecks: isRecord(item.safety_checks) ? item.safety_checks : null,
      signedByName: signedBy ? (names[signedBy] ?? null) : null,
      signedAt: text(item.signed_at),
      expiresAt: text(item.expires_at),
      rejectedAt: text(item.rejected_at),
      rejectionReason: text(item.rejection_reason),
      patientConfirmedAt: text(item.patient_confirmed_at),
      patientDeclinedAt: text(item.patient_declined_at),
      declineReason: text(item.decline_reason),
      expiredAt: text(item.expired_at),
      appliedAt: text(item.applied_at),
      createdAt: text(item.created_at),
      carePlanId: text(item.care_plan_id),
    });
  }
  return out;
}

export const KIND_LABEL: Record<ChangeKind, string> = {
  medication: "Medicine",
  target: "Care plan target",
  reading_schedule: "Reading schedule",
};

/** The id of each profile a list refers to, so the action can look the names up once. */
export function staffIdsIn(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!isRecord(item)) continue;
    for (const key of ["signed_by", "proposed_by_user"] as const) {
      const v = text(item[key]);
      if (v) ids.add(v);
    }
  }
  return [...ids];
}

/** State in plain words, with the date that matters. `formatDate` is injected so this stays pure. */
export function stateSummary(change: StaffCareChange, formatDate: (iso: string) => string): string {
  const on = (iso: string | null) => (iso ? ` on ${formatDate(iso)}` : "");
  switch (change.state) {
    case "proposed":
      return "Draft. Not signed, and the patient cannot see it.";
    case "signed":
      return change.expiresAt
        ? `Waiting for the patient. It lapses on ${formatDate(change.expiresAt)} if they do not answer.`
        : "Waiting for the patient.";
    case "confirmed":
      return `Confirmed by the patient${on(change.patientConfirmedAt)} and applied.`;
    case "declined":
      return `Declined by the patient${on(change.patientDeclinedAt)}. Nothing was changed.`;
    case "expired":
      return `Lapsed${on(change.expiredAt ?? change.expiresAt)}: the patient did not answer. Nothing was changed.`;
    case "rejected":
      return `Rejected${on(change.rejectedAt)}. Nothing was changed.`;
  }
}

const STATE_TONE: Record<ChangeState, "amber" | "blue" | "green" | "grey" | "red"> = {
  proposed: "amber",
  signed: "blue",
  confirmed: "green",
  declined: "grey",
  expired: "grey",
  rejected: "grey",
};
export function stateTone(state: ChangeState) {
  return STATE_TONE[state];
}

export const STATE_LABEL: Record<ChangeState, string> = {
  proposed: "Draft",
  signed: "Waiting for the patient",
  confirmed: "Confirmed",
  declined: "Declined",
  expired: "Lapsed",
  rejected: "Rejected",
};

function medicineLine(item: unknown): string {
  const o = isRecord(item) ? item : {};
  const parts = [text(o.drug_name), text(o.dose), text(o.frequency), text(o.route)].filter((p): p is string => p !== null);
  const days = typeof o.duration_days === "number" && o.duration_days > 0 ? `for ${o.duration_days} days` : null;
  if (days) parts.push(days);
  const qty = text(o.quantity);
  if (qty) parts.push(`quantity ${qty}`);
  return parts.length > 0 ? parts.join(", ") : "A medicine";
}

function settingsLine(obj: unknown): string | null {
  if (!isRecord(obj)) return null;
  const parts = Object.entries(obj)
    .map(([k, v]) => {
      const label = k.split("_").join(" ");
      if (isRecord(v)) {
        const min = text(v.min);
        const max = text(v.max);
        if (min && max) return `${label}: ${min} to ${max}`;
        if (max) return `${label}: up to ${max}`;
        if (min) return `${label}: at least ${min}`;
        return null;
      }
      const t = text(v);
      return t ? `${label}: ${t}` : null;
    })
    .filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join("; ") : null;
}

/** Before and after, as plain lines for the review. `before` is null for a new medicine. */
export function describeChange(change: StaffCareChange): { heading: string; before: string | null; after: string | null } {
  const p = change.proposal;
  if (change.kind === "medication") {
    if (p.action === "start") return { heading: "Start a medicine", before: null, after: medicineLine(p.item) };
    if (p.action === "change") return { heading: "Change a medicine", before: medicineLine(change.before), after: medicineLine(p.item) };
    return { heading: "Stop a medicine", before: medicineLine(change.before), after: "Stop taking it" };
  }
  if (change.kind === "target") {
    return {
      heading: "Change the care plan targets",
      before: settingsLine(change.before?.target_ranges) ?? "Nothing set",
      after: settingsLine(p.target_ranges),
    };
  }
  return {
    heading: "Change the reading schedule",
    before: settingsLine(change.before?.reading_schedule) ?? "Nothing set",
    after: settingsLine(p.reading_schedule),
  };
}

/** A flat, readable list of what the engine saw. Nested values are shown as compact JSON, never dropped. */
export function describeEngineInputs(inputs: Record<string, unknown> | null): { label: string; value: string }[] {
  if (!inputs) return [];
  return Object.entries(inputs).map(([key, value]) => {
    const label = key.split("_").join(" ");
    if (value === null || value === undefined) return { label, value: "not known" };
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return { label, value: String(value) };
    return { label, value: JSON.stringify(value) };
  });
}

/** The safety checks recorded at signing: the override reason and whether the allergy list was confirmed. */
export function describeSafetyChecks(checks: Record<string, unknown> | null): string[] {
  if (!checks) return [];
  const lines: string[] = [];
  const findings = Array.isArray(checks.findings) ? checks.findings : [];
  for (const f of findings) {
    if (!isRecord(f)) continue;
    if (f.code === "allergy_match") lines.push(`Allergy match${text(f.allergen) ? `: ${text(f.allergen)}` : ""}`);
    else if (f.code === "allergies_unrecorded") lines.push("Allergy list was empty");
    else if (f.code === "duplicate_active") lines.push("Same medicine already active");
  }
  if (checks.allergies_confirmed === true) lines.push("Signer confirmed the allergy list was checked");
  const reason = text(checks.override_reason);
  if (reason) lines.push(`Reason for going ahead: ${reason}`);
  if (findings.length === 0 && lines.length === 0) lines.push("No findings");
  return lines;
}

/**
 * One "no proposal because" reason in plain words, from the message catalogue part of the evaluator ships (TITRATION_STOP_KEYS ->
 * packages/i18n). An unknown code is still shown, never hidden.
 */
export function describeNoProposalReason(reason: { code: string; detail?: string }): string {
  const key = (TITRATION_STOP_KEYS as Record<string, string>)[reason.code];
  if (!key) return `The check "${reason.code.split("_").join(" ")}" stopped a suggestion${reason.detail?.trim() ? `: ${reason.detail.trim()}` : "."}`;
  const detail = reason.detail?.trim();
  const message = t(key as MessageKey, "en", detail ? { detail } : undefined);
  // With no detail the "({detail})" tail would print literally, so it is dropped.
  return detail ? message : message.replace(/\s*\(\{detail\}\)/, "");
}

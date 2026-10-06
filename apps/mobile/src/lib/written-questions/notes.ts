import type { Json } from "@tarragon/shared";
import type { MessageKey } from "@tarragon/i18n";
import { isRecord, str } from "./types";

export type ReleaseState = "not_requested" | "requested" | "released" | "declined";
export type AmendmentKind = "addendum" | "late_entry" | "correction";
export type CorrectionState = "open" | "accepted" | "annotated" | "declined";

export interface NoteIndexItem {
  id: string;
  encounterType: string;
  signedAt: string;
  releaseState: ReleaseState;
  withholdReason: string | null;
}

export interface NoteCorrection {
  id: string;
  state: CorrectionState;
  requestText: string;
  response: string | null;
  createdAt: string;
}

export interface ReleasedNote {
  id: string;
  amendsNoteId: string | null;
  amendmentKind: AmendmentKind | null;
  amendmentReason: string | null;
  encounterType: string;
  reason: string | null;
  history: string | null;
  examination: string | null;
  assessment: string | null;
  diagnosis: string | null;
  plan: string | null;
  followUp: string | null;
  signedAt: string;
  corrections: NoteCorrection[];
}

const RELEASE_STATES: readonly ReleaseState[] = ["not_requested", "requested", "released", "declined"];
const AMENDMENT_KINDS: readonly AmendmentKind[] = ["addendum", "late_entry", "correction"];
const CORRECTION_STATES: readonly CorrectionState[] = ["open", "accepted", "annotated", "declined"];

export function parseNoteIndex(raw: Json | null): NoteIndexItem[] {
  if (!Array.isArray(raw)) return [];
  const out: NoteIndexItem[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = str(item.id);
    const signedAt = str(item.signed_at);
    if (!id || !signedAt) continue;
    out.push({
      id,
      encounterType: str(item.encounter_type) ?? "",
      signedAt,
      releaseState: RELEASE_STATES.find((s) => s === item.release_state) ?? "not_requested",
      withholdReason: str(item.withhold_reason),
    });
  }
  return out;
}

function parseCorrections(raw: Json | undefined): NoteCorrection[] {
  if (!Array.isArray(raw)) return [];
  const out: NoteCorrection[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = str(item.id);
    const requestText = str(item.request_text);
    const createdAt = str(item.created_at);
    if (!id || requestText === null || !createdAt) continue;
    out.push({
      id,
      state: CORRECTION_STATES.find((s) => s === item.state) ?? "open",
      requestText,
      response: str(item.response),
      createdAt,
    });
  }
  return out;
}

export function parseReleasedNotes(raw: Json | null): ReleasedNote[] {
  if (!Array.isArray(raw)) return [];
  const out: ReleasedNote[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = str(item.id);
    const signedAt = str(item.signed_at);
    if (!id || !signedAt) continue;
    out.push({
      id,
      amendsNoteId: str(item.amends_note_id),
      amendmentKind: AMENDMENT_KINDS.find((k) => k === item.amendment_kind) ?? null,
      amendmentReason: str(item.amendment_reason),
      encounterType: str(item.encounter_type) ?? "",
      reason: str(item.reason),
      history: str(item.history),
      examination: str(item.examination),
      assessment: str(item.assessment),
      diagnosis: str(item.diagnosis),
      plan: str(item.plan),
      followUp: str(item.follow_up),
      signedAt,
      corrections: parseCorrections(item.corrections),
    });
  }
  return out;
}

export const NOTE_SECTION_KEYS: readonly { field: "reason" | "history" | "examination" | "assessment" | "diagnosis" | "plan" | "followUp"; key: MessageKey }[] = [
  { field: "reason", key: "notes.section.reason" },
  { field: "history", key: "notes.section.history" },
  { field: "examination", key: "notes.section.examination" },
  { field: "assessment", key: "notes.section.assessment" },
  { field: "diagnosis", key: "notes.section.diagnosis" },
  { field: "plan", key: "notes.section.plan" },
  { field: "followUp", key: "notes.section.follow_up" },
];

/** Only sections that have text are shown, in a fixed order. */
export function visibleSections(note: ReleasedNote): { key: MessageKey; text: string }[] {
  const out: { key: MessageKey; text: string }[] = [];
  for (const s of NOTE_SECTION_KEYS) {
    const text = note[s.field];
    if (text && text.trim().length > 0) out.push({ key: s.key, text });
  }
  return out;
}

export function amendmentLabelKey(kind: AmendmentKind): MessageKey {
  switch (kind) {
    case "addendum":
      return "notes.amendment.addendum";
    case "late_entry":
      return "notes.amendment.late_entry";
    case "correction":
      return "notes.amendment.correction";
  }
}

export function correctionStateKey(state: CorrectionState): MessageKey {
  switch (state) {
    case "open":
      return "notes.correction.open";
    case "accepted":
      return "notes.correction.accepted";
    case "annotated":
      return "notes.correction.annotated";
    case "declined":
      return "notes.correction.declined";
  }
}

/** The request button shows only before a request, and again never while one is open or granted. */
export function canRequestRelease(state: ReleaseState): boolean {
  return state === "not_requested" || state === "declined";
}

export const CORRECTION_MIN_CHARS = 10;
export const CORRECTION_MAX_CHARS = 2000;

export function checkCorrectionText(text: string): boolean {
  const n = text.trim().length;
  return n >= CORRECTION_MIN_CHARS && n <= CORRECTION_MAX_CHARS;
}

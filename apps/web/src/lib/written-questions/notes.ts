import { z } from "zod";
import type { MessageKey } from "@tarragon/i18n";

const correctionSchema = z.object({
  id: z.string(),
  state: z.string(),
  request_text: z.string(),
  response: z.string().nullable().optional(),
  created_at: z.string(),
});

export const releasedNoteSchema = z.object({
  id: z.string(),
  amends_note_id: z.string().nullable().optional(),
  amendment_kind: z.string().nullable().optional(),
  amendment_reason: z.string().nullable().optional(),
  encounter_type: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  history: z.string().nullable().optional(),
  examination: z.string().nullable().optional(),
  assessment: z.string().nullable().optional(),
  diagnosis: z.string().nullable().optional(),
  plan: z.string().nullable().optional(),
  follow_up: z.string().nullable().optional(),
  signed_at: z.string().nullable().optional(),
  signed_by: z.string().nullable().optional(),
  corrections: z.array(correctionSchema).nullable().optional(),
});
export type ReleasedNote = z.infer<typeof releasedNoteSchema>;

export const noteIndexEntrySchema = z.object({
  id: z.string(),
  encounter_type: z.string().nullable().optional(),
  signed_at: z.string().nullable().optional(),
  release_state: z.enum(["not_requested", "requested", "released", "declined"]),
  withhold_reason: z.string().nullable().optional(),
});
export type NoteIndexEntry = z.infer<typeof noteIndexEntrySchema>;

function parseList<T>(schema: z.ZodType<T>, raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    const p = schema.safeParse(item);
    if (p.success) out.push(p.data);
  }
  return out;
}
export const parseNoteIndex = (raw: unknown): NoteIndexEntry[] => parseList(noteIndexEntrySchema, raw);
export const parseReleasedNotes = (raw: unknown): ReleasedNote[] => parseList(releasedNoteSchema, raw);

export const NOTE_SECTIONS = [
  ["reason", "notes.section.reason"],
  ["history", "notes.section.history"],
  ["examination", "notes.section.examination"],
  ["assessment", "notes.section.assessment"],
  ["diagnosis", "notes.section.diagnosis"],
  ["plan", "notes.section.plan"],
  ["follow_up", "notes.section.follow_up"],
] as const satisfies readonly (readonly [keyof ReleasedNote, MessageKey])[];

/** Sections in reading order; empty ones are skipped. */
export function noteSections(note: ReleasedNote): { key: MessageKey; text: string }[] {
  const out: { key: MessageKey; text: string }[] = [];
  for (const [field, key] of NOTE_SECTIONS) {
    const v = note[field];
    if (typeof v === "string" && v.trim()) out.push({ key, text: v });
  }
  return out;
}

export const AMENDMENT_KEYS: Record<string, MessageKey> = {
  addendum: "notes.amendment.addendum",
  late_entry: "notes.amendment.late_entry",
  correction: "notes.amendment.correction",
};

export const CORRECTION_STATE_KEYS: Record<string, MessageKey> = {
  open: "notes.correction.open",
  accepted: "notes.correction.accepted",
  annotated: "notes.correction.annotated",
  declined: "notes.correction.declined",
};

export interface NoteGroup {
  entry: NoteIndexEntry;
  note: ReleasedNote | null;
  amendments: ReleasedNote[];
}

/**
 * Index entries become top-level cards, except a released amendment whose original is also released: that one is shown
 * beside its original. An amendment whose original is not released stays visible on its own.
 */
export function groupNotes(index: NoteIndexEntry[], released: ReleasedNote[]): NoteGroup[] {
  const byId = new Map(released.map((n) => [n.id, n]));
  const hiddenAsAmendment = new Set(
    released.filter((n) => n.amends_note_id && byId.has(n.amends_note_id)).map((n) => n.id)
  );
  return index
    .filter((e) => !hiddenAsAmendment.has(e.id))
    .map((entry) => ({
      entry,
      note: entry.release_state === "released" ? (byId.get(entry.id) ?? null) : null,
      amendments: released.filter((n) => n.amends_note_id === entry.id),
    }));
}

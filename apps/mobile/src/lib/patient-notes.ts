import type { QueryResult } from "./medications";
import { supabase } from "./supabase";
import {
  parseNoteIndex,
  parseReleasedNotes,
  type NoteIndexItem,
  type ReleasedNote,
} from "./written-questions/notes";

/** The patient side of S22 clinical notes. Only signed notes, and only released ones in full. */
export async function loadNoteIndex(): Promise<QueryResult<NoteIndexItem[]>> {
  const { data, error } = await supabase.rpc("my_note_index");
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: parseNoteIndex(data) };
}

export async function loadReleasedNotes(): Promise<QueryResult<ReleasedNote[]>> {
  const { data, error } = await supabase.rpc("my_released_notes");
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: parseReleasedNotes(data) };
}

export async function requestNoteRelease(noteId: string): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("request_note_release", { p_note: noteId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

export async function requestNoteCorrection(noteId: string, text: string): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("request_note_correction", { p_note: noteId, p_text: text.trim() });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

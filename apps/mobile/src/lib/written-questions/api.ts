import type { QueryResult } from "../medications";
import { supabase } from "../supabase";
import { mapWrittenQuestionError } from "./errors";
import { stripJpegMetadata } from "./limits";
import { parseAllowance, parseWrittenQuestions } from "./parse";
import type { WrittenQuestion, WrittenQuestionAllowance } from "./types";
import type { MessageKey } from "@tarragon/i18n";

/**
 * The patient side of S22 written questions. Everything goes through the
 * database functions: patients can no longer read the underlying table.
 * No price, balance or credit amount is ever read or shown (INV-09).
 */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; key: MessageKey };

export const WRITTEN_QUESTION_BUCKET = "async-consult-attachments";

export async function loadAllowance(): Promise<QueryResult<WrittenQuestionAllowance>> {
  const { data, error } = await supabase.rpc("my_written_question_allowance");
  if (error) return { ok: false, error: error.message };
  const parsed = parseAllowance(data);
  if (!parsed) return { ok: false, error: "unreadable allowance" };
  return { ok: true, data: parsed };
}

export async function loadWrittenQuestions(): Promise<QueryResult<WrittenQuestion[]>> {
  const { data, error } = await supabase.rpc("my_written_questions");
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: parseWrittenQuestions(data) };
}

export async function postWrittenQuestionMessage(consultId: string, body: string): Promise<ApiResult<string>> {
  const { data, error } = await supabase.rpc("post_written_question_message", {
    p_consult: consultId,
    p_body: body.trim(),
  });
  if (error || !data) return { ok: false, key: mapWrittenQuestionError(error?.message) };
  return { ok: true, data };
}

/**
 * Reads a picked or captured photo and returns the JPEG bytes with the metadata (location, device)
 * stripped, or null when the file is unreadable, not a JPEG, empty or over the size limit. The
 * queue stores these cleaned bytes, so what is sent is exactly what was checked.
 */
export async function readCleanPhoto(uri: string, maxBytes: number): Promise<Uint8Array | null> {
  try {
    const response = await fetch(uri);
    const raw = new Uint8Array(await response.arrayBuffer());
    const clean = stripJpegMetadata(raw);
    if (!clean || clean.length === 0 || clean.length > maxBytes) return null;
    return clean;
  } catch {
    return null;
  }
}

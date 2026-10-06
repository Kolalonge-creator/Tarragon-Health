import * as Crypto from "expo-crypto";
import type { QueryResult } from "../medications";
import { supabase } from "../supabase";
import { mapWrittenQuestionError } from "./errors";
import { photoStoragePath, stripJpegMetadata } from "./limits";
import { parseAllowance, parseWrittenQuestions } from "./parse";
import type { WrittenQuestion, WrittenQuestionAllowance, WrittenQuestionCategory } from "./types";
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

export async function submitWrittenQuestion(input: {
  category: WrittenQuestionCategory;
  question: string;
  durationNote: string;
}): Promise<ApiResult<string>> {
  const { data, error } = await supabase.rpc("submit_written_question", {
    p_category: input.category,
    p_question: input.question.trim(),
    ...(input.durationNote.trim() ? { p_duration_note: input.durationNote.trim() } : {}),
  });
  if (error || !data) return { ok: false, key: mapWrittenQuestionError(error?.message) };
  return { ok: true, data };
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
 * Uploads one photo to the private bucket, then registers it. The metadata is
 * stripped from the JPEG bytes first. Returns false on any failure so the caller
 * can say the photo did not go; the question itself is already sent by then.
 */
export async function uploadQuestionPhoto(input: {
  userId: string;
  consultId: string;
  uri: string;
  maxBytes: number;
}): Promise<boolean> {
  try {
    const response = await fetch(input.uri);
    const raw = new Uint8Array(await response.arrayBuffer());
    const clean = stripJpegMetadata(raw);
    if (!clean || clean.length > input.maxBytes) return false;
    const path = photoStoragePath(input.userId, input.consultId, Crypto.randomUUID());
    const { error: uploadError } = await supabase.storage
      .from(WRITTEN_QUESTION_BUCKET)
      .upload(path, clean, { contentType: "image/jpeg", upsert: false });
    if (uploadError) return false;
    const { error } = await supabase.rpc("attach_written_question_photo", {
      p_consult: input.consultId,
      p_path: path,
      p_mime: "image/jpeg",
      p_bytes: clean.length,
    });
    return !error;
  } catch {
    return false;
  }
}

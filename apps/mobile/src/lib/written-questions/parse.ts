import type { Json } from "@tarragon/shared";
import { DEFAULT_MAX_PHOTO_BYTES, DEFAULT_MAX_PHOTOS } from "./limits";
import {
  isRecord,
  num,
  str,
  type AnswerKind,
  type WrittenQuestion,
  type WrittenQuestionAllowance,
  type WrittenQuestionMessage,
  type WrittenQuestionStatus,
} from "./types";

const STATUSES: readonly WrittenQuestionStatus[] = ["submitted", "in_review", "answered", "closed"];
const KINDS: readonly AnswerKind[] = ["guidance", "needs_more_information", "needs_call"];

function parseMessage(raw: Json | undefined): WrittenQuestionMessage | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const body = str(raw.body);
  const createdAt = str(raw.created_at);
  const role = raw.author_role;
  if (!id || body === null || !createdAt) return null;
  if (role !== "patient" && role !== "care_team") return null;
  return { id, authorRole: role, body, createdAt };
}

/** Rows that do not look right are dropped, never shown half-filled. */
export function parseWrittenQuestions(raw: Json | null): WrittenQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: WrittenQuestion[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const id = str(item.id);
    const question = str(item.question);
    const createdAt = str(item.created_at);
    const status = STATUSES.find((s) => s === item.status);
    if (!id || question === null || !createdAt || !status) continue;
    const kind = KINDS.find((k) => k === item.answer_kind) ?? null;
    const messages = Array.isArray(item.messages)
      ? item.messages.map(parseMessage).filter((m): m is WrittenQuestionMessage => m !== null)
      : [];
    out.push({
      id,
      category: str(item.category) ?? "general",
      question,
      status,
      answer: str(item.answer),
      answerKind: kind,
      createdAt,
      answeredAt: str(item.answered_at),
      windowDueAt: str(item.window_due_at),
      followUpUntil: str(item.follow_up_until),
      windowMissedAt: str(item.window_missed_at),
      photos: num(item.photos, 0),
      messages,
    });
  }
  return out;
}

export function parseAllowance(raw: Json | null): WrittenQuestionAllowance | null {
  if (!isRecord(raw)) return null;
  return {
    isMember: raw.is_member === true,
    hasCredit: raw.has_credit === true,
    allowance: num(raw.allowance, 0),
    used: num(raw.used, 0),
    remaining: Math.max(0, num(raw.remaining, 0)),
    windowMinutes: num(raw.window_minutes, 1440),
    followUpDays: num(raw.follow_up_days, 7),
    maxPhotos: num(raw.max_photos, DEFAULT_MAX_PHOTOS),
    maxPhotoBytes: num(raw.max_photo_bytes, DEFAULT_MAX_PHOTO_BYTES),
  };
}

import type { Json } from "@tarragon/shared";

export type WrittenQuestionCategory = "medication" | "symptom" | "results" | "lifestyle" | "general";
export const WRITTEN_QUESTION_CATEGORIES: readonly WrittenQuestionCategory[] = [
  "medication",
  "symptom",
  "results",
  "lifestyle",
  "general",
];

export type WrittenQuestionStatus = "submitted" | "in_review" | "answered" | "closed";
export type AnswerKind = "guidance" | "needs_more_information" | "needs_call";

export interface WrittenQuestionMessage {
  id: string;
  authorRole: "patient" | "care_team";
  body: string;
  createdAt: string;
}

export interface WrittenQuestion {
  id: string;
  category: string;
  question: string;
  status: WrittenQuestionStatus;
  answer: string | null;
  answerKind: AnswerKind | null;
  createdAt: string;
  answeredAt: string | null;
  windowDueAt: string | null;
  followUpUntil: string | null;
  windowMissedAt: string | null;
  photos: number;
  messages: WrittenQuestionMessage[];
}

export interface WrittenQuestionAllowance {
  isMember: boolean;
  hasCredit: boolean;
  allowance: number;
  used: number;
  remaining: number;
  windowMinutes: number;
  followUpDays: number;
  maxPhotos: number;
  maxPhotoBytes: number;
}

export function isRecord(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function str(value: Json | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export function num(value: Json | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

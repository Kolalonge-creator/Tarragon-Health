import type { Json } from "./database.types";
import { THERAPY_ROUTE_PRIORITY, type TherapyRoute } from "./therapy-programmes";

/**
 * Typed readings of what the S63 database functions return. The functions return Json; a screen must never trust its shape, so each
 * reader checks it and answers with a closed result. An answer the reader does not understand is "unknown", which every screen treats
 * as "could not do that just now" and never as success.
 */

const isRecord = (v: unknown): v is Record<string, Json | undefined> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function asRoute(v: unknown): TherapyRoute | null {
  return typeof v === "string" && (THERAPY_ROUTE_PRIORITY as readonly string[]).includes(v) ? (v as TherapyRoute) : null;
}

export interface EntryQuestion {
  code: string;
  question: string;
  kind: "yes_no" | "score_at_least" | "score_below";
}

export interface EntryQuestions {
  programme: { code: string; title: string; summary: string; status: string };
  open: boolean;
  questions: EntryQuestion[];
}

export function readEntryQuestions(raw: unknown): EntryQuestions | null {
  if (!isRecord(raw) || !isRecord(raw.programme) || !Array.isArray(raw.questions)) return null;
  const code = str(raw.programme.code);
  const title = str(raw.programme.title);
  if (!code || !title) return null;
  const questions: EntryQuestion[] = [];
  for (const q of raw.questions) {
    if (!isRecord(q)) return null;
    const qc = str(q.code);
    const text = str(q.question);
    const kind = q.kind;
    if (!qc || !text || (kind !== "yes_no" && kind !== "score_at_least" && kind !== "score_below")) return null;
    questions.push({ code: qc, question: text, kind });
  }
  return {
    programme: { code, title, summary: str(raw.programme.summary) ?? "", status: str(raw.programme.status) ?? "" },
    open: raw.open === true,
    questions,
  };
}

export type EnrolOutcome =
  | { kind: "enrolled"; enrolmentId: string }
  | { kind: "blocked"; route: TherapyRoute | null; taskFailed: boolean }
  | { kind: "closed"; reason: "not_open_yet" | "not_available" }
  | { kind: "unknown" };

export function readEnrolOutcome(raw: unknown): EnrolOutcome {
  if (!isRecord(raw)) return { kind: "unknown" };
  if (raw.enrolled === true) {
    const id = str(raw.enrolment_id);
    return id ? { kind: "enrolled", enrolmentId: id } : { kind: "unknown" };
  }
  if (raw.enrolled === false) {
    if (raw.reason === "not_open_yet" || raw.reason === "not_available") return { kind: "closed", reason: raw.reason };
    if (raw.no_rules === true) return { kind: "closed", reason: "not_available" };
    if (raw.state === "blocked") return { kind: "blocked", route: asRoute(raw.route), taskFailed: raw.task_failed === true };
  }
  return { kind: "unknown" };
}

export interface SessionContent {
  programmeCode: string;
  programmeTitle: string;
  totalSessions: number;
  ordinal: number;
  title: string;
  kind: string;
  text: string;
  audioClipId: string | null;
  audioBytes: number | null;
  durationSeconds: number;
  checkpoint: boolean;
  instruments: string[];
  draftContent: boolean;
}

export type StartOutcome =
  | { kind: "ok"; session: SessionContent }
  | { kind: "stopped"; route: TherapyRoute | null }
  | { kind: "not_active" }
  | { kind: "not_open_yet" }
  | { kind: "content_not_approved" }
  | { kind: "unknown" };

export function readStartOutcome(raw: unknown): StartOutcome {
  if (!isRecord(raw)) return { kind: "unknown" };
  switch (raw.status) {
    case "ok": {
      if (!isRecord(raw.programme) || !isRecord(raw.session)) return { kind: "unknown" };
      const ordinal = num(raw.session.ordinal);
      const total = num(raw.programme.total_sessions);
      const title = str(raw.session.title);
      const text = str(raw.session.text);
      const duration = num(raw.session.duration_seconds);
      if (ordinal === null || total === null || !title || !text || duration === null) return { kind: "unknown" };
      return {
        kind: "ok",
        session: {
          programmeCode: str(raw.programme.code) ?? "",
          programmeTitle: str(raw.programme.title) ?? "",
          totalSessions: total,
          ordinal,
          title,
          kind: str(raw.session.kind) ?? "education",
          text,
          audioClipId: str(raw.session.audio_clip_id),
          audioBytes: num(raw.session.audio_bytes),
          durationSeconds: duration,
          checkpoint: raw.checkpoint === true,
          instruments: Array.isArray(raw.instruments) ? raw.instruments.filter((i): i is string => typeof i === "string") : [],
          draftContent: raw.draft_content === true,
        },
      };
    }
    case "stopped":
      return { kind: "stopped", route: asRoute(raw.route) };
    case "not_active":
      return { kind: "not_active" };
    case "not_open_yet":
      return { kind: "not_open_yet" };
    case "content_not_approved":
      return { kind: "content_not_approved" };
    default:
      return { kind: "unknown" };
  }
}

export type CompleteOutcome =
  | { kind: "ok"; completedCount: number; programmeCompleted: boolean; pausedForReview: boolean }
  | { kind: "not_active" }
  | { kind: "unknown" };

export function readCompleteOutcome(raw: unknown): CompleteOutcome {
  if (!isRecord(raw)) return { kind: "unknown" };
  if (raw.status === "ok") {
    return {
      kind: "ok",
      completedCount: num(raw.completed_count) ?? 0,
      programmeCompleted: raw.programme_completed === true,
      pausedForReview: raw.paused_for_review === true,
    };
  }
  if (raw.status === "not_active" || raw.status === "not_open_yet") return { kind: "not_active" };
  return { kind: "unknown" };
}

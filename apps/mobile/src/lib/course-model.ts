import { parseKnowledgeCheck, type KnowledgeCheckQuestion } from "./health-education";

/**
 * The blood pressure course as the phone sees it (S33). Pure: the reading of the `learning_course` rows, progress,
 * and the small decisions the screens make from them. Nothing here talks to the network or the audio module.
 */
export const BP_COURSE_CODE = "bp_care_course";

/** Playback speeds offered on a lesson recording (research S33 section 3). */
export const PLAYBACK_SPEEDS = [0.75, 1, 1.25] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export interface CourseLesson {
  readonly moduleNumber: number;
  readonly contentId: string;
  readonly audioClipId: string | null;
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly nextAction: string | null;
  readonly estimatedMinutes: number;
  readonly check: KnowledgeCheckQuestion | null;
  /** Set only from a complete review record on the server. Never inferred here. */
  readonly reviewedByName: string | null;
  readonly reviewedAt: string | null;
  readonly nextReviewDue: string | null;
  readonly status: "seen" | "understood" | "needs_review" | null;
}

export interface CourseRow {
  module_number: number;
  content_id: string;
  audio_clip_id: string | null;
  title: string;
  summary: string | null;
  body: string;
  next_action: string | null;
  estimated_minutes: number | null;
  knowledge_check: unknown;
  language_served: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  next_review_due: string | null;
  status: string | null;
}

const STATUSES = ["seen", "understood", "needs_review"] as const;

export function parseLesson(row: CourseRow): CourseLesson {
  const checks = parseKnowledgeCheck(row.knowledge_check);
  return {
    moduleNumber: row.module_number,
    contentId: row.content_id,
    audioClipId: row.audio_clip_id,
    title: row.title,
    summary: row.summary ?? "",
    body: row.body,
    nextAction: row.next_action && row.next_action.trim() !== "" ? row.next_action : null,
    estimatedMinutes: row.estimated_minutes ?? 3,
    check: checks ? checks[0] : null,
    // A credit needs a name AND a date: one without the other is not a review record.
    reviewedByName: row.reviewed_by_name && row.reviewed_at ? row.reviewed_by_name : null,
    reviewedAt: row.reviewed_by_name && row.reviewed_at ? row.reviewed_at : null,
    nextReviewDue: row.next_review_due,
    status: (STATUSES as readonly string[]).includes(row.status ?? "") ? (row.status as CourseLesson["status"]) : null,
  };
}

/** A lesson counts as done when its teach-back question has been answered. Opening it ('seen') is not finishing it. */
export const lessonDone = (l: Pick<CourseLesson, "status">): boolean => l.status === "understood" || l.status === "needs_review";

export interface CourseSummary {
  readonly total: number;
  readonly done: number;
  /** First lesson not yet done, in order; null when every lesson is done or the course is empty. */
  readonly next: CourseLesson | null;
  readonly finished: boolean;
}

export function summarise(lessons: readonly CourseLesson[]): CourseSummary {
  const ordered = [...lessons].sort((a, b) => a.moduleNumber - b.moduleNumber);
  const done = ordered.filter(lessonDone).length;
  return {
    total: ordered.length,
    done,
    next: ordered.find((l) => !lessonDone(l)) ?? null,
    finished: ordered.length > 0 && done === ordered.length,
  };
}

/** Lesson text is stored with blank lines between paragraphs. */
export const paragraphs = (body: string): string[] => body.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p !== "");

/** The course card is shown only when the server returns at least one lesson (nothing published means nothing shown). */
export const courseIsOpen = (lessons: readonly CourseLesson[]): boolean => lessons.length > 0;

export function nextSpeed(current: PlaybackSpeed): PlaybackSpeed {
  const i = PLAYBACK_SPEEDS.indexOf(current);
  return PLAYBACK_SPEEDS[(i + 1) % PLAYBACK_SPEEDS.length];
}

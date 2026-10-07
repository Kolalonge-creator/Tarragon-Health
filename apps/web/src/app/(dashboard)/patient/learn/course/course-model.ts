import { parseKnowledgeCheck, type KnowledgeCheckQuestion } from "@/lib/validation/health-education";

/**
 * The BP care course on the web (S33). Mirrors apps/mobile/src/lib/course-model.ts (the web and the app each own a copy,
 * as with the rest of the Learn code). Pure: no network, no React.
 */
export const BP_COURSE_CODE = "bp_care_course";

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

export interface CourseLesson {
  moduleNumber: number;
  contentId: string;
  title: string;
  summary: string;
  body: string;
  nextAction: string | null;
  estimatedMinutes: number;
  check: KnowledgeCheckQuestion | null;
  reviewedByName: string | null;
  nextReviewDue: string | null;
  status: "seen" | "understood" | "needs_review" | null;
}

const STATUSES = ["seen", "understood", "needs_review"] as const;

export function parseLesson(row: CourseRow): CourseLesson {
  const checks = parseKnowledgeCheck(row.knowledge_check);
  return {
    moduleNumber: row.module_number,
    contentId: row.content_id,
    title: row.title,
    summary: row.summary ?? "",
    body: row.body,
    nextAction: row.next_action && row.next_action.trim() !== "" ? row.next_action : null,
    estimatedMinutes: row.estimated_minutes ?? 3,
    check: checks ? checks[0] : null,
    // A credit needs a name AND a review date: one without the other is not a review record.
    reviewedByName: row.reviewed_by_name && row.reviewed_at ? row.reviewed_by_name : null,
    nextReviewDue: row.next_review_due,
    status: (STATUSES as readonly string[]).includes(row.status ?? "") ? (row.status as CourseLesson["status"]) : null,
  };
}

export const lessonDone = (l: Pick<CourseLesson, "status">): boolean => l.status === "understood" || l.status === "needs_review";

export function summarise(lessons: readonly CourseLesson[]) {
  const ordered = [...lessons].sort((a, b) => a.moduleNumber - b.moduleNumber);
  const done = ordered.filter(lessonDone).length;
  return { total: ordered.length, done, next: ordered.find((l) => !lessonDone(l)) ?? null, finished: ordered.length > 0 && done === ordered.length };
}

export const paragraphs = (body: string): string[] => body.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p !== "");


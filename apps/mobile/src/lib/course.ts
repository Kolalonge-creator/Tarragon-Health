import { supabase } from "./supabase";
import { BP_COURSE_CODE, parseLesson, type CourseLesson, type CourseRow } from "./course-model";
import { markContentProgress, submitContentFeedback } from "./health-education";
import type { QueryResult } from "./medications";

export type LoadCourseResult = { ok: true; lessons: CourseLesson[] } | { ok: false };

/**
 * One call returns the lessons this patient may see, in order, in English,
 * with progress. The server serves only published, in-date lessons, so an empty list means "not open", not an error.
 */
export async function loadCourse(code: string = BP_COURSE_CODE): Promise<LoadCourseResult> {
  const { data, error } = await supabase.rpc("learning_course", { p_programme_code: code });
  if (error) return { ok: false };
  return { ok: true, lessons: (data ?? []).map((r) => parseLesson({ ...r, summary: r.summary ?? null } as unknown as CourseRow)) };
}

/** Records the teach-back result. The status ('understood' or 'needs_review') is what completes the lesson. */
export function saveLessonResult(
  patientId: string,
  organisationId: string,
  lesson: Pick<CourseLesson, "contentId">,
  result: { allCorrect: boolean; score: number; total: number },
): Promise<QueryResult<null>> {
  return markContentProgress(patientId, organisationId, {
    contentId: lesson.contentId,
    status: result.allCorrect ? "understood" : "needs_review",
    checkScore: result.score,
    checkTotal: result.total,
  });
}

/** "Was this lesson clear?" uses the existing feedback reactions: helpful for yes, unclear for no. */
export function saveClarity(patientId: string, organisationId: string, lesson: Pick<CourseLesson, "contentId">, clear: boolean): Promise<QueryResult<null>> {
  return submitContentFeedback(patientId, organisationId, { contentId: lesson.contentId, feedbackType: clear ? "helpful" : "unclear" });
}

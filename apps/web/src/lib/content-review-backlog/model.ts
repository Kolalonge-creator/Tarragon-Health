import { z } from "zod";

/**
 * S80 gap closure (25.1): the CMO's review backlog for patient education content. The database decides which items are on it and why
 * (public.content_review_backlog); this only parses the answer and groups it. Reading the backlog never changes a status.
 */
export const BACKLOG_KINDS = ["needs_re_review", "review_overdue", "never_reviewed"] as const;
export type BacklogKind = (typeof BACKLOG_KINDS)[number];

export const KIND_LABEL: Record<BacklogKind, string> = {
  needs_re_review: "Text changed after approval",
  review_overdue: "Review date has passed",
  never_reviewed: "Live, never clinician reviewed",
};

export const backlogRowSchema = z.object({
  content_id: z.string().uuid(),
  code: z.string(),
  title: z.string(),
  content_status: z.string(),
  clinician_reviewed: z.boolean(),
  next_review_due: z.string().nullable(),
  days_overdue: z.number().int().nullable(),
  needs_re_review: z.boolean(),
  needs_re_review_reason: z.string().nullable(),
  safety_relevant: z.boolean(),
  author_name: z.string().nullable(),
  backlog_kind: z.enum(BACKLOG_KINDS),
});
export type BacklogRow = z.infer<typeof backlogRowSchema>;
export const backlogRowsSchema = z.array(backlogRowSchema);

export function groupBacklog(rows: readonly BacklogRow[]): Record<BacklogKind, BacklogRow[]> {
  const out: Record<BacklogKind, BacklogRow[]> = { needs_re_review: [], review_overdue: [], never_reviewed: [] };
  for (const r of rows) out[r.backlog_kind].push(r);
  return out;
}

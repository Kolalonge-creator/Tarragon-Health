import { z } from "zod";

/**
 * The triage grade review list and the accuracy report as the database returns them (S38e, Module 22.4). Parsed, never trusted.
 * This measures how often the clinician who handled a case agreed with the automatic grade. It is not diagnostic accuracy.
 */
export const AGREEMENTS = ["right", "should_have_been_higher", "should_have_been_lower"] as const;
export type Agreement = (typeof AGREEMENTS)[number];
export const GRADES = ["green", "amber", "red"] as const;

const reviewRow = z.object({ task_id: z.string().uuid(), task_type: z.string(), completed_at: z.string(), graded_as: z.enum(GRADES) });
export type ReviewRow = z.infer<typeof reviewRow>;
const reviewList = z.object({ status: z.enum(["ok", "not_available"]), rows: z.array(reviewRow) });
export function parseReviewList(data: unknown): { status: "ok" | "not_available"; rows: ReviewRow[] } | null {
  const r = reviewList.safeParse(data);
  return r.success ? r.data : null;
}

/** Choices a clinician may make for a grade: you cannot say a green grade should have been lower, or a red one higher. */
export function allowedAgreements(grade: (typeof GRADES)[number]): Agreement[] {
  return AGREEMENTS.filter((a) => !(grade === "green" && a === "should_have_been_lower") && !(grade === "red" && a === "should_have_been_higher"));
}

const withheld = z.object({ suppressed: z.literal(true), minimum: z.number().int() });
const cell = z.union([z.object({ key: z.string(), suppressed: z.literal(true) }), z.object({ key: z.string(), reviewed: z.number().int(), agree_pct: z.number(), should_have_been_higher_pct: z.number() })]);
export type AccuracyCell = z.infer<typeof cell>;
export const isShownCell = (c: AccuracyCell): c is Extract<AccuracyCell, { reviewed: number }> => !("suppressed" in c);

export const accuracySchema = z.object({
  range: z.object({ from: z.string(), to: z.string() }), minimum_cell: z.number().int(), capture_switched_on: z.boolean(),
  coverage: z.union([z.object({ suppressed: z.literal(false), completed_tasks_from_a_grade: z.number().int(), reviewed: z.number().int(), reviewed_pct: z.number(), low_coverage: z.boolean() }), withheld]),
  overall: z.union([z.object({ suppressed: z.literal(false), reviewed: z.number().int(), agree_pct: z.number(), should_have_been_higher_pct: z.number(), should_have_been_lower_pct: z.number() }), withheld]),
  by_grade: z.array(z.union([z.object({ graded_as: z.enum(GRADES), suppressed: z.literal(true), minimum: z.number().int() }),
    z.object({ graded_as: z.enum(GRADES), suppressed: z.literal(false), reviewed: z.number().int(), right: z.number().int(), should_have_been_higher: z.number().int(), should_have_been_lower: z.number().int(), agree_pct: z.number() })])),
  by: z.object({ sex: z.array(cell), age_band: z.array(cell), state: z.array(cell) }),
  draft_rule_set_reviews: z.number().int().nullable(),
  what_this_is: z.string(), limitations: z.string(), not_a_causal_claim: z.literal(true), generated_at: z.string(),
});
export type AccuracyReport = z.infer<typeof accuracySchema>;
export function parseAccuracy(data: unknown): AccuracyReport | null {
  const r = accuracySchema.safeParse(data);
  return r.success ? r.data : null;
}

import { z } from "zod";

/** The monthly risk-fairness history the admin page lists (S75d). Read-only; a reply that is half there is refused rather than half-rendered. */
export const fairnessHistorySchema = z.array(z.object({
  month: z.string(), generated_at: z.string(), reviewed: z.boolean(), reviewed_at: z.string().nullable(), review_note: z.string().nullable(), reviewed_by_name: z.string().nullable(),
  payload: z.object({ total_scored: z.number().int().nullable(), minimum_cell: z.number().int(), by: z.object({ sex: z.array(z.record(z.string(), z.unknown())), age_band: z.array(z.record(z.string(), z.unknown())), region: z.array(z.record(z.string(), z.unknown())) }) }),
}));
export type FairnessHistory = z.infer<typeof fairnessHistorySchema>;
export const parseFairnessHistory = (d: unknown): FairnessHistory | null => { const r = fairnessHistorySchema.safeParse(d); return r.success ? r.data : null; };

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { LISTING_TABLES, KIND_LABEL } from "./model";

/**
 * S80 gap closure (25.9): the chase list. The database computes the freshness score (it decays daily) and orders the list stalest first; this
 * parses the answer. A listing here is never hidden or switched off by the page.
 */
export const chaseRowSchema = z.object({
  listing_table: z.enum(LISTING_TABLES),
  listing_id: z.string().uuid(),
  name: z.string(),
  last_verified_at: z.string().nullable(),
  days_since_verified: z.number().int().nullable(),
  freshness_score: z.number().int().min(0).max(100),
  can_notify: z.boolean(),
  last_partner_notice_on: z.string().nullable(),
  would_be_hidden: z.boolean(),
});
export type ChaseRow = z.infer<typeof chaseRowSchema>;
export const chaseRowsSchema = z.array(chaseRowSchema);

export type ScoreBand = "fresh" | "ageing" | "stale";

/** Bands for reading the list only; the thresholds that act (notice, hide) live in the database from the PROPOSED config. */
export function scoreBand(score: number): ScoreBand {
  return score >= 70 ? "fresh" : score >= 40 ? "ageing" : "stale";
}

export function kindLabel(table: ChaseRow["listing_table"]): string {
  return KIND_LABEL[table] ?? table;
}

export type Loaded<T> = { ok: true; data: T } | { ok: false; denied: boolean };

export async function loadChaseList(): Promise<Loaded<ChaseRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("directory_chase_list", {});
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = chaseRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

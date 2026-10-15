import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { costRowsSchema, type CostRow } from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false; denied: boolean };

/** A failed read is a load failure the screen says so, never an empty table that looks like "no AI cost". */
export async function loadAiCost(from: string, to: string): Promise<Loaded<CostRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("ai_cost_by_feature", { p_from: from, p_to: to });
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = costRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

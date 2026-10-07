import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { costRowsSchema, queueRowsSchema, type CostRow, type QueueRow } from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false; denied: boolean };

export async function loadReviewQueue(): Promise<Loaded<QueueRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("ai_review_queue", { p_limit: 25 });
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = queueRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

export async function loadAiCost(): Promise<Loaded<CostRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("ai_cost_by_system_month", { p_months: 6 });
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = costRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

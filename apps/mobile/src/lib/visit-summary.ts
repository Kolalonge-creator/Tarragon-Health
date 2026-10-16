import type { QueryResult } from "./medications";
import { supabase } from "./supabase";
import { parseVisitSummaries, type VisitSummary } from "./visit-summary/parse";

/** The patient side of the after-visit summary (AVS). The database returns approved summaries only. */
export async function loadVisitSummaries(): Promise<QueryResult<VisitSummary[]>> {
  const { data, error } = await supabase.rpc("my_visit_summaries");
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: parseVisitSummaries(data) };
}

export async function setVisitItemDone(itemId: string, done: boolean): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("set_visit_summary_item_done", { p_item: itemId, p_done: done });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

export async function addVisitItemToTasks(itemId: string): Promise<QueryResult<null>> {
  const { error } = await supabase.rpc("add_visit_summary_item_to_tasks", { p_item: itemId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: null };
}

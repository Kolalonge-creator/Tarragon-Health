import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * The one question any audio, AI or "explain this result" feature must ask before it says anything about a structured lab result
 * (INV-04, S27). The answer comes from the database, which holds the only definition: a result is explainable only when it is
 * released, not withdrawn, not replaced, not a patient's own upload and carries no sensitive positive. Fails CLOSED: an error, a
 * missing row or another patient's id all answer "no".
 */
export async function canExplainLabResult(supabase: SupabaseClient<Database>, resultId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(resultId)) return false;
  const { data, error } = await supabase.rpc("lab_result_explain_allowed", { p_result: resultId });
  return !error && data === true;
}

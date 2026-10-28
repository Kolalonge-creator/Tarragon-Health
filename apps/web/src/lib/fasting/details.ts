import type { Fast } from "@tarragon/clinical/fasting-safety";
import { parseFastingDetails, UNAVAILABLE_DETAILS, type FastingDetails } from "@tarragon/clinical/fasting-details";
import { createClient } from "@/lib/supabase/client";

export { parseFastingDetails, UNAVAILABLE_DETAILS };
export type { FastingDetails };

/** Asks the database. An error is the unavailable answer (the same one a withheld person gets), never a permissive guess. */
export async function fetchFastingDetails(fast: Fast, startsOn: string | null, endsOn: string | null): Promise<FastingDetails> {
  const supabase = createClient();
  const [gate, plan] = await Promise.all([supabase.rpc("my_fasting_gate", { p_fast: fast, p_starts_on: startsOn, p_ends_on: endsOn }), supabase.rpc("my_fasting_plan")]);
  // A plan that cannot be read is "no plan shown"; a gate that cannot be read is the unavailable answer. Neither is ever a permissive guess.
  return parseFastingDetails(gate.error ? null : gate.data, plan.error ? null : plan.data);
}

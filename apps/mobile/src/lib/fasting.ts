import { supabase } from "./supabase";
import type { Fast } from "@tarragon/clinical/fasting-safety";
import { parseFastingDetails, type FastingDetails } from "@tarragon/clinical/fasting-details";

/**
 * Fasting and your health on the phone (S50b, 6.13). public.my_fasting_gate() is the one answer; the phone only reads and shows it. If the question
 * cannot be asked (offline, an error) or the reply cannot be read, the answer is the unavailable one (talk to your care team), never a guess.
 * The medicine timing the screen can show is only a clinician's own signed words; nothing is generated on the phone.
 */
export async function loadFastingDetails(fast: Fast): Promise<FastingDetails> {
  const [gate, plan] = await Promise.all([supabase.rpc("my_fasting_gate", { p_fast: fast, p_starts_on: null, p_ends_on: null }), supabase.rpc("my_fasting_plan")]);
  return parseFastingDetails(gate.error ? null : gate.data, plan.error ? null : plan.data);
}

export type FastingWrite = { ok: true } | { ok: false };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Dates are typed as YYYY-MM-DD; the database re-checks the window and re-runs the safety gate whatever this sends. */
export async function startFastingPlan(fast: Fast, startsOn: string, endsOn: string): Promise<FastingWrite> {
  if (!ISO_DATE.test(startsOn) || !ISO_DATE.test(endsOn) || endsOn < startsOn) return { ok: false };
  const { error } = await supabase.rpc("start_fasting_plan", { p_fast: fast, p_starts_on: startsOn, p_ends_on: endsOn });
  return error ? { ok: false } : { ok: true };
}

export async function endFastingPlan(reason: "finished" | "stopped_by_person"): Promise<FastingWrite> {
  const { error } = await supabase.rpc("end_fasting_plan", { p_reason: reason });
  return error ? { ok: false } : { ok: true };
}

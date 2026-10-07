import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";

/** A clinician's own reliability signal (S78c, spec 23.20): their score and the counts behind it, never a position among colleagues. */
export const signalSchema = z.object({
  score: z.number().nullable(),
  window_days: z.number().int().min(1),
  completed_on_time: z.number().int().min(0),
  completed_late: z.number().int().min(0),
  claims_expired: z.number().int().min(0),
  handed_back: z.number().int().min(0),
});
export type Signal = z.infer<typeof signalSchema>;

export type SignalResult = { ok: true; data: Signal } | { ok: false };

/** A failed read shows nothing wrong: the card says it could not load, never a zero score. */
export async function loadMyReliabilitySignal(): Promise<SignalResult> {
  const { data, error } = await loose(await createClient()).rpc("my_reliability_signal", {});
  if (error) return { ok: false };
  const parsed = signalSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}

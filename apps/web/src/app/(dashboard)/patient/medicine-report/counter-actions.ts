"use server";

import { createClient } from "@/lib/supabase/server";
import { createCounterSnapshot } from "@/lib/medicines/counter-snapshot";

/**
 * Makes the pharmacy-counter page for the signed-in patient (their own account only: the database function and the adherence read both use their
 * own session). The link token and PIN come back in this response only, to be shown once; nothing is stored or logged here.
 */
export type CounterState =
  | { status: "idle" }
  | { status: "made"; path: string; pin: string; expiresAt: string }
  | { status: "failed"; reason: "closed" | "no_doses" | "too_many" | "report_failed" | "failed" };

const HOURS = [1, 2, 4, 8, 24];

export async function makeCounterPage(_prev: CounterState, form: FormData): Promise<CounterState> {
  const requested = Number(form.get("hours"));
  const hours = HOURS.includes(requested) ? requested : 2;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "failed", reason: "failed" };

  const result = await createCounterSnapshot(supabase, user.id, hours);
  if (!result.ok) return { status: "failed", reason: result.reason };
  return { status: "made", path: `/share/counter/${result.token}`, pin: result.pin, expiresAt: result.expiresAt };
}

import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { payoutRowsSchema, unpaidRowsSchema, type PayoutRow, type UnpaidRow } from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false };

/** A failed read is a load failure the screen says so, never an empty list. */
export async function loadPayouts(): Promise<Loaded<PayoutRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("list_payouts", {});
  if (error) return { ok: false };
  const parsed = payoutRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}

export async function loadUnpaid(): Promise<Loaded<UnpaidRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("payout_unpaid_summary", {});
  if (error) return { ok: false };
  const parsed = unpaidRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
}

/** Whether the payouts_enabled guard is on. Unknown (null) is treated as off by the screen. */
export async function loadPayoutsGuard(): Promise<boolean | null> {
  const { data, error } = await loose(await createClient()).rpc("payouts_guard_is_on", {});
  return error || typeof data !== "boolean" ? null : data;
}

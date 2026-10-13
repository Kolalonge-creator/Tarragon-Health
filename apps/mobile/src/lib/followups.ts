import { supabase } from "./supabase";
import { parseFollowups, parsePick, type Followups, type PickOutcome } from "./followups-model";

/**
 * Two-tier model, item 3: the Member's monthly check-in, over the SAME database functions the web card uses. Reads and the pick go
 * straight to the database as the signed-in Member (the functions check auth.uid()); the pick runs the live hold and confirm, so
 * nothing about booking is duplicated here. NOT run on a real phone: no EAS dev-client build exists for this app yet.
 */
type RpcResult = { data: unknown; error: { message: string } | null };
type RpcOnly = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> };
const db = (): RpcOnly => supabase as unknown as RpcOnly;

export type LoadResult<T> = { ok: true; data: T } | { ok: false };

/** React Native's fetch has no timeout of its own: a stalled connection would leave the card pending for ever. */
const TIMEOUT_MS = 15_000;
function withTimeout<T>(work: PromiseLike<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS);
    Promise.resolve(work).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export async function loadFollowups(): Promise<LoadResult<Followups>> {
  try {
    const { data, error } = await withTimeout(db().rpc("my_followups", { p_patient: null }));
    const parsed = error ? null : parseFollowups(data);
    return parsed ? { ok: true, data: parsed } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** A failure is "failed", never a booked time: the Member is only told it is booked when the database says so. */
export async function pickFollowupSlot(slotId: string, askLonger: boolean): Promise<PickOutcome> {
  try {
    const { data, error } = await withTimeout(db().rpc("pick_followup_slot", { p_slot: slotId, p_ask_longer: askLonger }));
    return error ? { kind: "failed" } : parsePick(data);
  } catch {
    return { kind: "failed" };
  }
}

export async function requestLongerCall(encounterId: string): Promise<boolean> {
  try {
    const { data, error } = await withTimeout(db().rpc("request_longer_call", { p_encounter: encounterId }));
    return !error && !!data && typeof data === "object" && (data as { longer_requested?: unknown }).longer_requested === true;
  } catch {
    return false;
  }
}

import type { MessageKey } from "@tarragon/i18n";
import type { QueryResult } from "../medications";
import { supabase } from "../supabase";
import { errorCodeOf } from "./api";

/**
 * Check my health plan (S71, 19.6), the phone side. The member number is typed once, sent once to the hmo-eligibility function over TLS and never kept:
 * not in storage, not in a list, not returned by the server. Every reply is parsed; a reply that does not match means "nothing to show", never a guess.
 */
const HMO_RESULTS = ["pending_manual", "eligible", "not_eligible"] as const;
export type HmoResult = (typeof HMO_RESULTS)[number];
export interface HmoPlan { hmoId: string; name: string }
export interface HmoCheckRow { checkId: string; hmoName: string; result: HmoResult; checkedAt: string; decidedAt: string | null }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === "string";

/** A bad row is dropped; a bad reply is "none", and the card then does not show. */
export function parseHmoPlans(data: unknown): HmoPlan[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r: unknown) => (isObj(r) && str(r["hmo_id"]) && str(r["name"]) ? [{ hmoId: r["hmo_id"], name: r["name"] }] : []));
}

export function parseHmoChecks(data: unknown): HmoCheckRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r: unknown) => {
    if (!isObj(r)) return [];
    const result = HMO_RESULTS.find((x) => x === r["result"]);
    if (!result || !str(r["check_id"]) || !str(r["hmo_name"]) || !str(r["checked_at"])) return [];
    return [{ checkId: r["check_id"], hmoName: r["hmo_name"], result, checkedAt: r["checked_at"], decidedAt: str(r["decided_at"]) ? r["decided_at"] : null }];
  });
}

export function parseHmoReply(data: unknown): { checkId: string; result: HmoResult } | null {
  if (!isObj(data) || !str(data["check_id"])) return null;
  const result = HMO_RESULTS.find((x) => x === data["result"]);
  return result ? { checkId: data["check_id"], result } : null;
}

const HMO_ERROR_KEYS: Readonly<Record<string, MessageKey>> = {
  hmo_not_available: "hmo.error.hmo_not_available",
  hmo_check_rate_limited: "hmo.error.hmo_check_rate_limited",
  sponsor_payment_not_open: "hmo.error.sponsor_payment_not_open",
  member_number_invalid: "hmo.error.member_number_invalid",
  hmo_not_configured: "hmo.error.hmo_not_configured",
};
export function hmoErrorKey(code: unknown): MessageKey {
  return (typeof code === "string" ? HMO_ERROR_KEYS[code] : undefined) ?? "hmo.error.unknown";
}

export const HMO_RESULT_KEYS: Readonly<Record<HmoResult, MessageKey>> = {
  eligible: "hmo.result.eligible",
  not_eligible: "hmo.result.not_eligible",
  pending_manual: "hmo.result.pending_manual",
};

/** The shape the function accepts. Checked here only to save a pointless round trip; the database applies the real rules. */
export const isPlausibleMemberNumber = (v: string): boolean => /^[A-Za-z0-9][A-Za-z0-9 /-]{2,59}$/.test(v.trim());

/** The health plans with a Tarragon programme. Empty while the sponsor go-live guard is off, so the card does not show (fails closed). */
export async function loadHmoPlans(): Promise<QueryResult<HmoPlan[]>> {
  const { data, error } = await supabase.rpc("available_hmos");
  return error ? { ok: false, error: error.message } : { ok: true, data: parseHmoPlans(data) };
}

/** The person's own checks: plan name, result and dates only. The number is never returned. */
export async function loadMyHmoChecks(): Promise<QueryResult<HmoCheckRow[]>> {
  const { data, error } = await supabase.rpc("my_hmo_eligibility");
  return error ? { ok: false, error: error.message } : { ok: true, data: parseHmoChecks(data) };
}

export async function requestHmoCheck(hmoId: string, memberNumber: string): Promise<{ ok: true; result: HmoResult } | { ok: false; code: string }> {
  const { data, error } = await supabase.functions.invoke("hmo-eligibility", { body: { hmo_id: hmoId, member_number: memberNumber.trim() } });
  if (error) return { ok: false, code: await errorCodeOf(error) };
  const reply = parseHmoReply(data);
  return reply ? { ok: true, result: reply.result } : { ok: false, code: "unknown" };
}

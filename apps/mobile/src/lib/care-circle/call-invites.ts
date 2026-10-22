import { supabase } from "../supabase";
import type { QueryResult } from "../medications";

/**
 * CGJ: a patient invites one Care Circle member into ONE consultation call, and the member answers. These are thin wrappers over the same
 * database functions the web room uses (the database decides who may do what; this module only asks and parses). Every reply is parsed,
 * never trusted. Nothing here is a link to the call, a key, a reading or a surname. Joining a call as a guest runs in the web browser,
 * because the Expo app has no call SDK (OQ-158): the caregiver's invite card opens the web room.
 *
 * NOT run on a real phone: no EAS dev-client build exists for this app yet.
 */
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type RpcOnly = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> };
const db = (): RpcOnly => supabase as unknown as RpcOnly;

/** A call that throws (offline, a reset connection) is a failed call, never an unhandled rejection in a screen. */
async function safe(fn: string, args?: Record<string, unknown>): Promise<RpcResult> {
  try {
    return await db().rpc(fn, args);
  } catch {
    return { data: null, error: { message: "network" } };
  }
}

export type CallPassState = "invited" | "accepted" | "declined" | "removed";
export interface CallPass { pass_id: string; relationship: string; state: CallPassState; name: string | null }
export interface CallInvitable { member_id: string; name: string; relationship: string }
export interface CallCaregivers { live: boolean; max: number; passes: CallPass[]; invitable: CallInvitable[] }
export interface CallInvite { pass_id: string; encounter_id: string; patient_first_name: string; state: "invited" | "accepted"; scheduled_at: string; joinable: boolean }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === "string";

/** Parsed by hand, like the rest of the Care Circle: a reply that is not what was expected means "nothing to show", never a half-drawn card. */
export function parseCallCaregivers(data: unknown): CallCaregivers | null {
  if (!isObj(data) || typeof data["live"] !== "boolean" || typeof data["max"] !== "number" || !Number.isInteger(data["max"]) || data["max"] < 1) return null;
  if (!Array.isArray(data["passes"]) || !Array.isArray(data["invitable"])) return null;
  const passes: CallPass[] = [];
  for (const p of data["passes"]) {
    if (!isObj(p) || !str(p["pass_id"]) || !str(p["relationship"])) return null;
    const state = p["state"];
    if (state !== "invited" && state !== "accepted" && state !== "declined" && state !== "removed") return null;
    const name = p["name"];
    if (name !== null && !str(name)) return null;
    passes.push({ pass_id: p["pass_id"], relationship: p["relationship"], state, name });
  }
  const invitable: CallInvitable[] = [];
  for (const m of data["invitable"]) {
    if (!isObj(m) || !str(m["member_id"]) || !str(m["name"]) || !str(m["relationship"])) return null;
    invitable.push({ member_id: m["member_id"], name: m["name"], relationship: m["relationship"] });
  }
  return { live: data["live"], max: data["max"], passes, invitable };
}

/** A row that does not match is dropped (for example an invite state this build does not know). */
export function parseCallInvites(data: unknown): CallInvite[] {
  if (!Array.isArray(data)) return [];
  const out: CallInvite[] = [];
  for (const i of data) {
    if (!isObj(i) || !str(i["pass_id"]) || !str(i["encounter_id"]) || !str(i["patient_first_name"]) || !str(i["scheduled_at"]) || typeof i["joinable"] !== "boolean") continue;
    const state = i["state"];
    if (state !== "invited" && state !== "accepted") continue;
    out.push({ pass_id: i["pass_id"], encounter_id: i["encounter_id"], patient_first_name: i["patient_first_name"], state, scheduled_at: i["scheduled_at"], joinable: i["joinable"] });
  }
  return out;
}

/** Where the guest's call opens: the web room (the app has no call SDK). */
export const callInviteWebPath = (encounterId: string): string => `/patient/supporting/consultation/${encodeURIComponent(encounterId)}`;

/** Counts against the cap: an invite waiting for an answer, or accepted. */
export const activeCallPasses = (l: CallCaregivers): CallPass[] => l.passes.filter((p) => p.state === "invited" || p.state === "accepted");

export type CallActionResult = "ok" | "not_allowed" | "failed";
const outcome = (error: RpcResult["error"]): CallActionResult => (!error ? "ok" : error.code === "42501" ? "not_allowed" : "failed");

/** Null data means the person is not on that call (the database answers the same for a stranger and an unknown id). */
export async function loadCallCaregivers(encounterId: string): Promise<QueryResult<CallCaregivers | null>> {
  const { data, error } = await safe("consultation_caregivers", { p_encounter: encounterId });
  if (error) return { ok: false, error: "failed" };
  if (data === null) return { ok: true, data: null };
  const list = parseCallCaregivers(data);
  return list ? { ok: true, data: list } : { ok: false, error: "failed" };
}

export async function inviteToCall(encounterId: string, memberId: string): Promise<CallActionResult> {
  const { error } = await safe("invite_caregiver_to_consultation", { p_encounter: encounterId, p_member: memberId });
  return outcome(error);
}

export async function cancelCallInvite(passId: string): Promise<CallActionResult> {
  const { error } = await safe("cancel_caregiver_invite", { p_pass: passId });
  return outcome(error);
}

export async function loadMyCallInvites(): Promise<QueryResult<CallInvite[]>> {
  const { data, error } = await safe("my_consultation_invites");
  return error ? { ok: false, error: "failed" } : { ok: true, data: parseCallInvites(data) };
}

export async function answerCallInvite(passId: string, accept: boolean): Promise<CallActionResult> {
  const { error } = await safe("respond_caregiver_consultation_invite", { p_pass: passId, p_accept: accept });
  return outcome(error);
}

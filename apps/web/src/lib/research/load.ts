import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import {
  adminChallengesSchema, ledgerRowsSchema, myChallengesSchema, protocolRowsSchema, requestRowsSchema,
  type AdminChallenge, type LedgerRow, type MyChallenge, type ProtocolRow, type RequestRow,
} from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false; denied: boolean };

async function call<T>(fn: string, schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } }): Promise<Loaded<T>> {
  const { data, error } = await loose(await createClient()).rpc(fn, {});
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = schema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

export const loadExportRequests = (): Promise<Loaded<RequestRow[]>> => call("research_export_requests_list", requestRowsSchema);
export const loadLedger = (): Promise<Loaded<LedgerRow[]>> => call("research_ledger", ledgerRowsSchema);
export const loadMyChallenges = (): Promise<Loaded<MyChallenge[]>> => call("my_research_challenges", myChallengesSchema);
export const loadAdminChallenges = (): Promise<Loaded<AdminChallenge[]>> => call("research_challenges_list", adminChallengesSchema);

export async function loadProtocols(): Promise<Loaded<ProtocolRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("research_protocols_list", {});
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = protocolRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

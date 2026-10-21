import { supabase } from "./supabase";

/**
 * Records requests on the phone (docs/design/RRL.md): the person's own list, and the four things they can say about one. The letter itself is made on
 * the web (an A4 print page); nothing here sends anything to a facility. Every call goes through the same patient functions the web uses, so the
 * go-live guard, the owner checks and the append-only history are the database's.
 */
export type RecordsRequestState = "prepared" | "sent" | "received" | "withdrawn";

export interface RecordsRequestRow {
  id: string;
  facility_name: string;
  scope_codes: string[];
  state: RecordsRequestState;
  requested_at: string | null;
  due_at: string | null;
  received_at: string | null;
  note: string | null;
  is_overdue: boolean;
}

export type RecordsRequestResult = { ok: true } | { ok: false; reason: "not_found" | "failed" };

type Rpc = (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as Rpc)(fn, args);

const STATES: readonly string[] = ["prepared", "sent", "received", "withdrawn"];

/** Reads the person's own requests. A row it cannot read makes the whole read fail (shown as a failure), so a request can never quietly vanish. */
export async function listRecordsRequests(call: Rpc = rpc): Promise<RecordsRequestRow[]> {
  const { data, error } = await call("my_records_requests");
  if (error || !Array.isArray(data)) throw new Error("records requests could not be read");
  return data.map((r): RecordsRequestRow => {
    const x = r as Partial<RecordsRequestRow> | null;
    if (!x || typeof x.id !== "string" || typeof x.facility_name !== "string" || typeof x.state !== "string" || !STATES.includes(x.state)) {
      throw new Error("a records request could not be read");
    }
    return {
        id: x.id,
        facility_name: x.facility_name,
        scope_codes: Array.isArray(x.scope_codes) ? x.scope_codes.filter((c): c is string => typeof c === "string") : [],
        state: x.state as RecordsRequestState,
        requested_at: x.requested_at ?? null,
        due_at: x.due_at ?? null,
        received_at: x.received_at ?? null,
        note: x.note ?? null,
        is_overdue: x.is_overdue === true,
    };
  });
}

async function run(fn: string, args: Record<string, unknown>, call: Rpc): Promise<RecordsRequestResult> {
  const { error } = await call(fn, args);
  if (!error) return { ok: true };
  return { ok: false, reason: error.code === "P0002" ? "not_found" : "failed" };
}

export const markRequestReceived = (id: string, call: Rpc = rpc) => run("mark_records_request_received", { p_id: id }, call);
export const withdrawRequest = (id: string, call: Rpc = rpc) => run("withdraw_records_request", { p_id: id }, call);
export const setRequestNote = (id: string, note: string, call: Rpc = rpc) =>
  run("set_records_request_note", { p_id: id, p_note: note.trim() === "" ? null : note.trim().slice(0, 500) }, call);

/** The count the home or passport screens can show: handed over, past the reminder date, no reply. */
export function overdueCount(rows: readonly RecordsRequestRow[]): number {
  return rows.filter((r) => r.is_overdue).length;
}

export function formatRequestDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

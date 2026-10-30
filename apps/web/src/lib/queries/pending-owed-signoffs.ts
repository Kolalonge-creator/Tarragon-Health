import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/** The prefix every owed-signature line on the sign-off hub carries, so the page can attach the signing panel to each. */
export const OWED_ITEM_PREFIX = "owed:";

export type OwedSignoff = {
  subjectKey: string;
  title: string;
  detail: string;
  /** The thing is already in effect, so it is live without a signature. False when it is only drafted. */
  running: boolean;
};

export type PendingOwedSignoffs = {
  rows: OwedSignoff[];
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

type Row = { subject_key: string; title: string; detail: string; running: boolean };
type Loose = {
  from(table: string): {
    select(columns: string): { is(column: string, value: null): { order(column: string, o: { ascending: boolean }): PromiseLike<{ data: Row[] | null; error: unknown }> } };
  };
};

/**
 * The signatures the Chief Medical Officer still owes for things that are running or drafted but are not a governed configuration row
 * (a safety case document, switches pressed from a chat session, an unverified licence). Read from public.owed_signoffs, which only the
 * CMO's own organisation can see; for anyone else the table reads as empty, so this is only called from the CMO's hub. Never throws: a
 * failed read says so, because the one wrong thing the hub can say is "all clear".
 */
export async function readPendingOwedSignoffs(supabase: SupabaseClient<Database>): Promise<PendingOwedSignoffs> {
  try {
    const { data, error } = await (supabase as unknown as Loose)
      .from("owed_signoffs")
      .select("subject_key, title, detail, running")
      .is("signed_at", null)
      .order("raised_at", { ascending: true });
    if (error || !data) return { rows: [], failed: true };
    return { rows: data.map((r) => ({ subjectKey: r.subject_key, title: r.title, detail: r.detail, running: r.running })), failed: false };
  } catch {
    return { rows: [], failed: true };
  }
}

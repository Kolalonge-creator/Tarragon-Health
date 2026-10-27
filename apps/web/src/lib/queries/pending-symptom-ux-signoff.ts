import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { newestWaiting } from "@/lib/queries/pending-quality-config-signoff";

/** The four configs the symptom checker's assessment experience needs signed (S59c). */
export const SYMPTOM_UX_KINDS = ["checkback", "describe", "explainer", "safety_net"] as const;
export type SymptomUxKind = (typeof SYMPTOM_UX_KINDS)[number];

export type SymptomUxWaiting = { kind: SymptomUxKind; version: number; rules: unknown };

export type PendingSymptomUxSignoff = {
  /** The newest unsigned, inactive version of each kind that is newer than the one in force. */
  waiting: SymptomUxWaiting[];
  /** The read failed: never render this as an all-clear. */
  failed: boolean;
};

type Row = { kind: string; version: number; is_active: boolean; approved_at: string | null; rules?: unknown };
type Loose = { from(table: string): { select(columns: string): PromiseLike<{ data: Row[] | null; error: unknown }> } };

/** Pure: which versions wait, per kind, with the draft's own rules (the words the CMO signs are the values that will apply). */
export function waitingSymptomUx(rows: Row[]): SymptomUxWaiting[] {
  const out: SymptomUxWaiting[] = [];
  for (const kind of SYMPTOM_UX_KINDS) {
    const mine = rows.filter((r) => r.kind === kind);
    const version = newestWaiting(mine);
    if (version !== null) out.push({ kind, version, rules: mine.find((r) => r.version === version)?.rules ?? null });
  }
  return out;
}

/** What the assessment-experience configs need from the Chief Medical Officer, for the sign-off hub. Never throws; a failed read says so. */
export async function readPendingSymptomUxSignoff(supabase: SupabaseClient<Database>): Promise<PendingSymptomUxSignoff> {
  try {
    const res = await (supabase as unknown as Loose).from("symptom_ux_config").select("kind, version, is_active, approved_at, rules");
    if (res.error || !res.data) return { waiting: [], failed: true };
    return { waiting: waitingSymptomUx(res.data), failed: false };
  } catch {
    return { waiting: [], failed: true };
  }
}

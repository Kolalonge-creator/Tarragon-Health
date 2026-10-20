import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { parseCuffCheckConfig, type CuffCheckConfig } from "@tarragon/clinical";

export type CuffCheckVersion = {
  id: string;
  version: number;
  isActive: boolean;
  approvedAt: string | null;
  notes: string | null;
  /** Null when the stored value did not pass the configuration check (shown as an error, never signed). */
  config: CuffCheckConfig | null;
};

/**
 * Every stored version of the cuff check rules, newest first, and the one the Chief Medical Officer should look at: the live signed version, or else the newest
 * unsigned draft that is NEWER than the live one (an older draft is history, signing it would roll back). Never throws: a failed read is reported through `loadFailed`.
 */
export async function readCuffCheckRules(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase
    .from("cuff_check_rules")
    .select("id, version, is_active, approved_at, notes, config")
    .order("version", { ascending: false });
  if (error || !data) return { versions: [] as CuffCheckVersion[], live: null, pending: null, loadFailed: true };
  const versions: CuffCheckVersion[] = data.map((r) => {
    let config: CuffCheckConfig | null = null;
    try {
      config = parseCuffCheckConfig(r.version, r.config);
    } catch {
      config = null;
    }
    return { id: r.id, version: r.version, isActive: r.is_active, approvedAt: r.approved_at, notes: r.notes, config };
  });
  const live = versions.find((v) => v.isActive && v.approvedAt !== null) ?? null;
  const pending = versions.find((v) => !v.isActive && v.approvedAt === null && v.version > (live?.version ?? 0)) ?? null;
  return { versions, live, pending, loadFailed: false };
}

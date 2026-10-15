import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { parseHomeBpConfig, type HomeBpConfig } from "@tarragon/clinical";

export type HomeBpVersion = {
  id: string;
  version: number;
  isActive: boolean;
  approvedAt: string | null;
  notes: string | null;
  /** Null when the stored value did not pass the configuration check (shown as an error, never signed). */
  config: HomeBpConfig | null;
};

/**
 * Every stored version of the home BP programme configuration, newest first, and the one the Chief Medical Officer should look at:
 * the live signed version, or else the newest unsigned draft that is NEWER than the live one (an older draft is history, signing it would roll back).
 * Never throws: a read that fails is reported through `loadFailed`.
 */
export async function readHomeBpProgramme(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase
    .from("home_bp_programme_signoffs")
    .select("id, version, is_active, approved_at, notes, config")
    .order("version", { ascending: false });
  if (error || !data) return { versions: [] as HomeBpVersion[], live: null, pending: null, loadFailed: true };
  const versions: HomeBpVersion[] = data.map((r) => {
    let config: HomeBpConfig | null = null;
    try {
      config = parseHomeBpConfig(r.version, r.config);
    } catch {
      config = null;
    }
    return { id: r.id, version: r.version, isActive: r.is_active, approvedAt: r.approved_at, notes: r.notes, config };
  });
  const live = versions.find((v) => v.isActive && v.approvedAt !== null) ?? null;
  const pending = versions.find((v) => !v.isActive && v.approvedAt === null && v.version > (live?.version ?? 0)) ?? null;
  return { versions, live, pending, loadFailed: false };
}

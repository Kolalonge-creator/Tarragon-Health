import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * The three go-live guards behind the reading labels and the paper diary (S07y), read for the signed-in person (INV-14). All three are born OFF.
 * A test account passes a guard, as everywhere. Fail closed: a guard that cannot be read is a closed guard, which keeps today's behaviour.
 *
 *  - pharmacy_bp_readings   the "taken at a pharmacy or clinic machine" label on a blood pressure reading
 *  - paper_diary_entry      readings copied from a paper diary, typed by the person (works with no model)
 *  - paper_diary_ai_reader  reading a photo of a diary page into suggestions (AI-021); needs the AI registry's own switch as well
 */
export const PHARMACY_BP_GUARD = "pharmacy_bp_readings";
export const DIARY_ENTRY_GUARD = "paper_diary_entry";
export const DIARY_AI_GUARD = "paper_diary_ai_reader";

export interface ProvenanceGuards {
  pharmacyOpen: boolean;
  diaryEntryOpen: boolean;
  diaryReaderOpen: boolean;
}

export const NO_PROVENANCE_GUARDS: ProvenanceGuards = { pharmacyOpen: false, diaryEntryOpen: false, diaryReaderOpen: false };

export async function isGuardOpen(supabase: SupabaseClient<Database>, key: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("go_live_guard_is_open", { p_key: key });
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function readProvenanceGuards(supabase: SupabaseClient<Database>): Promise<ProvenanceGuards> {
  const [pharmacyOpen, diaryEntryOpen, diaryReaderOpen] = await Promise.all([
    isGuardOpen(supabase, PHARMACY_BP_GUARD),
    isGuardOpen(supabase, DIARY_ENTRY_GUARD),
    isGuardOpen(supabase, DIARY_AI_GUARD),
  ]);
  return { pharmacyOpen, diaryEntryOpen, diaryReaderOpen };
}

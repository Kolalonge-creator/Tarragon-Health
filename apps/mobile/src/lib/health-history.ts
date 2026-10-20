import { en, t, type MessageKey } from "@tarragon/i18n";
import { validateFamilyHistory, validateProcedure, type HistoryValidationError } from "@tarragon/shared";
import { supabase } from "./supabase";
import { isOffline, readThrough, type ReadResult } from "./passport-cache";

/**
 * Procedures and family history (S43, spec 2.2) on the phone. Same tables, same RLS and the same removal function as the web page
 * (apps/web/src/lib/health-history/actions.ts). Reads fall back to the last copy (passport-cache.ts); writes need a connection and say so,
 * because an entry that looks saved but is not is worse than one that waits: history is not an outbox kind and no treatment depends on it.
 */
export interface ProcedureItem {
  id: string;
  name: string;
  approximate_year: number | null;
  performed_on: string | null;
  facility: string | null;
  verified_by_clinician: boolean;
}

export interface FamilyItem {
  id: string;
  condition_name: string;
  relationship: string;
  age_of_onset_years: number | null;
  verified_by_clinician: boolean;
}

export interface HistoryData {
  procedures: ProcedureItem[];
  family: FamilyItem[];
}

export const historyCacheKey = (subjectId: string) => `history:${subjectId}`;

export function loadHistory(subjectId: string): Promise<ReadResult<HistoryData>> {
  return readThrough(historyCacheKey(subjectId), async () => {
    const [procedures, family] = await Promise.all([
      supabase
        .from("procedures")
        .select("id, name, approximate_year, performed_on, facility, verified_by_clinician")
        .eq("patient_id", subjectId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("family_history")
        .select("id, condition_name, relationship, age_of_onset_years, verified_by_clinician")
        .eq("patient_id", subjectId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (procedures.error) return { ok: false, error: procedures.error };
    if (family.error) return { ok: false, error: family.error };
    return { ok: true, data: { procedures: (procedures.data ?? []) as ProcedureItem[], family: (family.data ?? []) as FamilyItem[] } };
  });
}

/** A rough year is shown as the year only, because many people remember nothing more. */
export function procedureWhen(p: Pick<ProcedureItem, "performed_on" | "approximate_year">): string {
  if (p.performed_on) {
    const y = new Date(p.performed_on).getFullYear();
    if (!Number.isNaN(y)) return String(y);
  }
  return p.approximate_year ? String(p.approximate_year) : "";
}

export type WriteResult = { ok: true } | { ok: false; reason: "offline" | "failed" | HistoryValidationError };

interface WriteContext {
  userId: string;
  organisationId: string;
}

export async function addProcedure(input: { name: string; year?: string; facility?: string }, ctx: WriteContext): Promise<WriteResult> {
  const v = validateProcedure(input);
  if (!v.ok) return { ok: false, reason: v.error };
  const { error } = await supabase.from("procedures").insert({
    organisation_id: ctx.organisationId,
    patient_id: ctx.userId,
    name: v.value.name,
    approximate_year: v.value.year,
    facility: v.value.facility,
  });
  if (error) return { ok: false, reason: isOffline(error) ? "offline" : "failed" };
  return { ok: true };
}

export async function addFamilyHistory(input: { condition: string; relationship: string; onsetAge?: string }, ctx: WriteContext): Promise<WriteResult> {
  const v = validateFamilyHistory(input);
  if (!v.ok) return { ok: false, reason: v.error };
  const { error } = await supabase.from("family_history").insert({
    organisation_id: ctx.organisationId,
    patient_id: ctx.userId,
    condition_name: v.value.condition,
    relationship: v.value.relationship,
    age_of_onset_years: v.value.onsetAge,
  });
  if (error) return { ok: false, reason: isOffline(error) ? "offline" : "failed" };
  return { ok: true };
}

/** Removal is a tombstone in the database, never a silent delete: a clinician-confirmed item stays in the record for audit. */
export async function removeHistoryItem(kind: "procedure" | "family_history", id: string): Promise<WriteResult> {
  const { error } = await supabase.rpc("remove_history_item", { p_kind: kind, p_id: id });
  if (error) return { ok: false, reason: isOffline(error) ? "offline" : "failed" };
  return { ok: true };
}

/** A relative as the person would say it. An older row may hold a word outside the list; it is shown plainly, never as a missing label. */
export function relativeLabel(relationship: string): string {
  const key = `mpass.relative.${relationship}`;
  return Object.hasOwn(en, key) ? t(key as MessageKey) : relationship.replace(/_/g, " ");
}

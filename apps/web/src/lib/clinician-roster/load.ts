import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import {
  competencyRowsSchema, grantsHistorySchema, rosterSchema,
  type CompetencyRow, type GrantsHistory, type RosterRow,
} from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false; denied: boolean };

const fail = (error: { code?: string }): { ok: false; denied: boolean } => ({ ok: false, denied: error.code === "42501" });

/** A failed read is a load failure the screen says so, never an empty roster. */
export async function loadRoster(): Promise<Loaded<RosterRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("clinician_roster", {});
  if (error) return fail(error);
  const parsed = rosterSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

export async function loadCompetencies(): Promise<Loaded<CompetencyRow[]>> {
  const { data, error } = await loose(await createClient()).from("competencies").select("code,label,requires_level,is_active").order("code", { ascending: true });
  if (error) return fail(error);
  const parsed = competencyRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

export async function loadGrantsHistory(): Promise<Loaded<GrantsHistory>> {
  const { data, error } = await loose(await createClient()).rpc("permission_grants_history", {});
  if (error) return fail(error);
  const parsed = grantsHistorySchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

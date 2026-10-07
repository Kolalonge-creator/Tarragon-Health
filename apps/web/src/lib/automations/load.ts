import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { automationRowsSchema, type AutomationRow } from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false; denied: boolean };

/** A failed read is a load failure the screen says so, never an empty list that looks like "every job is fine". */
export async function loadAutomations(): Promise<Loaded<AutomationRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("automations_overview", {});
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = automationRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { dashboardSchema, dashboardSettings, type Dashboard } from "./model";

export type Loaded = { ok: true; data: Dashboard } | { ok: false; denied: boolean };

/** One read. A refused or failed read, or an answer that does not parse, is a load failure the screen says so; never zeros. */
export async function loadDashboard(): Promise<Loaded> {
  const s = dashboardSettings();
  const { data, error } = await loose(await createClient()).rpc("reliability_dashboard", { p_gap_days: s.gap_days, p_min_group: s.min_group });
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = dashboardSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

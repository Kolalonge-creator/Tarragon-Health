import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { workloadSchema, type Workload } from "./model";

export type Loaded = { ok: true; data: Workload } | { ok: false; denied: boolean };

/** One audited read of the workload dashboard. A refused or failed read, or an answer that does not parse, is a load failure the screen says so; never zeros. */
export async function loadWorkload(days: number): Promise<Loaded> {
  const { data, error } = await loose(await createClient()).rpc("clinician_workload_dashboard", { p_days: days });
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = workloadSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

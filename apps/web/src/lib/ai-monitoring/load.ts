import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { accuracySchema, overviewSchema, type Accuracy, type Overview } from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false; denied: boolean };

export async function loadOverview(): Promise<Loaded<Overview>> {
  const { data, error } = await loose(await createClient()).rpc("ai_monitoring_overview");
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = overviewSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

/** The S38e escalation-accuracy report: how often the clinician who handled a case agreed with the automatic grade. Reused as is, not recomputed. */
export async function loadEscalationAccuracy(): Promise<Loaded<Accuracy>> {
  const { data, error } = await loose(await createClient()).rpc("triage_accuracy_report");
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = accuracySchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

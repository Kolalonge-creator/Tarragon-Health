"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { populationFiltersSchema } from "@/lib/populations/schemas";
import type { Json } from "@tarragon/shared";

export type SavePopulationState = { error?: string; success?: boolean } | undefined;
export type SetPopulationStatusState = { error?: string; success?: boolean } | undefined;
export type TriggerOutreachState = { error?: string; queued?: number } | undefined;

const NAME_PATTERN = /.{1,200}/;

function numberOrUndefined(raw: FormDataEntryValue | null): number | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Custom population definitions only — a system registry (spec §41.4) is
 * seeded once per organisation by the database trigger and can be edited
 * but never created fresh here (population_definitions' own RLS also
 * blocks an insert with is_system = true — this is belt-and-braces, not
 * the actual enforcement point).
 */
export async function createPopulationAction(
  _prev: SavePopulationState,
  formData: FormData
): Promise<SavePopulationState> {
  const name = formData.get("name");
  if (typeof name !== "string" || !NAME_PATTERN.test(name)) {
    return { error: "Name is required (max 200 characters)" };
  }
  const description = formData.get("description");

  const filters = populationFiltersSchema.safeParse({
    conditions: formData.getAll("conditions"),
    prevention_conditions: formData.getAll("prevention_conditions"),
    risk_levels: formData.getAll("risk_levels"),
    care_gap_types: formData.getAll("care_gap_types"),
    control_status: formData.getAll("control_status"),
    engagement: formData.getAll("engagement"),
    min_age: numberOrUndefined(formData.get("min_age")),
    max_age: numberOrUndefined(formData.get("max_age")),
    sex: formData.get("sex") || undefined,
    states: (formData.get("states") as string | null)
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    pregnant_only: formData.get("pregnant_only") === "on",
  });
  if (!filters.success) {
    return { error: filters.error.issues[0]?.message ?? "Invalid filters" };
  }

  const profile = await getCurrentProfile();
  if (!profile || profile.role === "patient" || !profile.organisation_id) {
    return { error: "Not authorised" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("population_definitions").insert({
    organisation_id: profile.organisation_id,
    name,
    description: typeof description === "string" && description.trim() ? description : null,
    kind: "custom",
    filters: filters.data as Json,
    created_by: profile.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/clinician/populations");
  return { success: true };
}

export async function setPopulationStatusAction(
  populationId: string,
  status: "active" | "archived"
): Promise<SetPopulationStatusState> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role === "patient") {
    return { error: "Not authorised" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("population_definitions")
    .update({ status })
    .eq("id", populationId);
  if (error) return { error: error.message };

  revalidatePath("/clinician/populations");
  revalidatePath(`/clinician/populations/${populationId}`);
  return { success: true };
}

/**
 * Staff-initiated version of the nightly outreach scan (spec §41.7/§41.14),
 * scoped to one population — see trigger_population_outreach() for what it
 * actually does (queues care_outreach_tasks + notifications, idempotent).
 */
export async function triggerOutreachAction(populationId: string): Promise<TriggerOutreachState> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role === "patient") {
    return { error: "Not authorised" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("trigger_population_outreach", {
    p_population_id: populationId,
  });
  if (error) return { error: error.message };

  revalidatePath(`/clinician/populations/${populationId}`);
  revalidatePath("/clinician/outreach");
  return { queued: data ?? 0 };
}

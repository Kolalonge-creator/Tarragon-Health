"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type FhirImportActionState = { error?: string; success?: boolean } | undefined;

/**
 * Confirm / dismiss are plain RLS-gated updates -- the real work (deriving
 * the confirming clinician, checking authority, excluding Care Coordinator,
 * and performing the actual vitals_readings/patient_allergies/medications/
 * vaccination_records write) all happens inside
 * private.enforce_fhir_import_resource_attribution, the trigger on
 * fhir_import_proposed_resources. Nothing here is trusted beyond "which row
 * and which reason" -- same "RLS admits, trigger narrows" split the
 * migration's own comments describe.
 */

const confirmSchema = z.object({ resourceId: z.string().uuid() });

export async function confirmFhirImportResourceAction(
  _prev: FhirImportActionState,
  formData: FormData
): Promise<FhirImportActionState> {
  const parsed = confirmSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "Invalid input" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("fhir_import_proposed_resources")
    .update({ status: "confirmed" })
    .eq("id", parsed.data.resourceId)
    .eq("status", "proposed");

  if (error) {
    return { error: error.message || "Could not confirm this resource" };
  }

  revalidatePath("/clinician/fhir-imports");
  return { success: true };
}

const dismissSchema = z.object({
  resourceId: z.string().uuid(),
  reason: z.string().trim().min(1, "A reason is required").max(2000),
});

export async function dismissFhirImportResourceAction(
  _prev: FhirImportActionState,
  formData: FormData
): Promise<FhirImportActionState> {
  const parsed = dismissSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase
    .from("fhir_import_proposed_resources")
    .update({ status: "dismissed", dismissal_reason: parsed.data.reason })
    .eq("id", parsed.data.resourceId)
    .eq("status", "proposed");

  if (error) {
    return { error: error.message || "Could not dismiss this resource" };
  }

  revalidatePath("/clinician/fhir-imports");
  return { success: true };
}

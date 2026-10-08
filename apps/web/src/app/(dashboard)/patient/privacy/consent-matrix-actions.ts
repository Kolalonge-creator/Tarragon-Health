"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CONSENT_DATA_TYPES, CONSENT_PURPOSES, consentErrorMessage } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";

export type ConsentMatrixActionState = { ok?: boolean; error?: string } | undefined;

const cellSchema = z.object({
  dataType: z.enum(CONSENT_DATA_TYPES),
  purpose: z.enum(CONSENT_PURPOSES),
  granted: z.boolean(),
});
const bundleSchema = z.object({ code: z.string().regex(/^[a-z_]{3,40}$/) });

function messageFor(error: { message?: string } | null): string {
  switch (consentErrorMessage(error?.message)) {
    case "required":
      return t("consent.matrix.error.required");
    default:
      return t("consent.matrix.error.generic");
  }
}

/**
 * Turn one cell of the consent matrix on or off (v5 1.13). The database decides: a required-for-care cell cannot be
 * withdrawn by anyone through any path (trigger `enforce_consent_matrix_event`), so this action never checks it itself and
 * only translates the refusal into a sentence. The patient's own session writes; no service role is involved.
 */
export async function setConsentCellAction(input: unknown): Promise<ConsentMatrixActionState> {
  const parsed = cellSchema.safeParse(input);
  if (!parsed.success) return { error: t("consent.matrix.error.generic") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_consent_cell", {
    p_data_type: parsed.data.dataType,
    p_purpose: parsed.data.purpose,
    p_granted: parsed.data.granted,
  });
  if (error) return { error: messageFor(error) };
  revalidatePath("/patient/privacy");
  return { ok: true };
}

/** Turn on every cell of a bundle (additive: a bundle never turns anything else off, and never holds a sensitive type). */
export async function applyConsentBundleAction(input: unknown): Promise<ConsentMatrixActionState> {
  const parsed = bundleSchema.safeParse(input);
  if (!parsed.success) return { error: t("consent.matrix.error.generic") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_consent_bundle", { p_bundle: parsed.data.code });
  if (error) return { error: messageFor(error) };
  revalidatePath("/patient/privacy");
  return { ok: true };
}

const featureSchema = z.object({ dataType: z.enum(["reproductive", "mental_health", "device_data"]) });

/**
 * S47: asked the first time a person uses a feature that handles reproductive health, mental health or device data. Grants only the CARE cell of that one
 * data type (consent_timing = on_first_use); everything else in the matrix is untouched. Declining is simply not calling this: nothing is recorded, the feature
 * stays off, and the rest of care is unaffected. Withdrawal later is the same switch in the privacy centre.
 */
export async function grantFeatureConsentAction(input: unknown): Promise<ConsentMatrixActionState> {
  const parsed = featureSchema.safeParse(input);
  if (!parsed.success) return { error: t("consent.matrix.error.generic") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_consent_cell", { p_data_type: parsed.data.dataType, p_purpose: "care", p_granted: true });
  if (error) return { error: messageFor(error) };
  revalidatePath("/patient/privacy");
  return { ok: true };
}

/** One tap back to the essentials. Required cells are not touched, so care is not affected. */
export async function withdrawAllOptionalConsentsAction(): Promise<ConsentMatrixActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_all_optional_consents");
  if (error) return { error: messageFor(error) };
  revalidatePath("/patient/privacy");
  return { ok: true };
}

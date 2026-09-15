"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type LabResultConsultPricingState = { error?: string; message?: string } | undefined;

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") throw new Error("Admin access required");
  return profile;
}

const saveSchema = z.object({
  organisationId: z.string().uuid().nullable(),
  amountNaira: z.coerce.number().gt(0).lt(10_000_000),
  currency: z.enum(["NGN", "GBP", "USD"]),
  isEnabled: z.boolean(),
});

/**
 * Upserts the platform-default row (organisationId null) or one
 * organisation's override. private.pin_lab_result_consult_amount reads
 * whichever row applies at request time — org override first, else the
 * default — so this is the only place the number is ever set.
 *
 * Runs through the admin's OWN session (lab_result_consult_prices_write's
 * RLS policy gates on private.is_admin()) rather than the service role, same
 * reasoning documented in diaspora-pricing/actions.ts: a service-role client
 * carries no auth.uid(), so an is_admin()-gated write must go through the
 * caller's real session. The audit_log insert afterwards uses the service
 * role, mirroring admin/settings/subscriptions/actions.ts's
 * "billing.price_adjustment" entries — the one real precedent this codebase
 * has for logging an admin-changed commercial price.
 */
export async function saveLabResultConsultPrice(
  _prev: LabResultConsultPricingState,
  formData: FormData,
): Promise<LabResultConsultPricingState> {
  const profile = await requireAdmin();

  const rawOrgId = String(formData.get("organisation_id") ?? "");
  const parsed = saveSchema.safeParse({
    organisationId: rawOrgId ? rawOrgId : null,
    amountNaira: formData.get("amount_naira"),
    currency: formData.get("currency"),
    isEnabled: formData.get("is_enabled") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the price and try again." };
  }
  const { organisationId, amountNaira, currency, isEnabled } = parsed.data;
  const amountMinor = Math.round(amountNaira * 100);

  const supabase = await createClient();

  const existingQuery = supabase
    .from("lab_result_consult_prices")
    .select("id, amount_minor, currency");
  const { data: existing } = await (
    organisationId
      ? existingQuery.eq("organisation_id", organisationId)
      : existingQuery.is("organisation_id", null)
  ).maybeSingle();

  const previous = existing ? { amount_minor: existing.amount_minor, currency: existing.currency } : null;

  const { data: saved, error } = existing
    ? await supabase
        .from("lab_result_consult_prices")
        .update({
          amount_minor: amountMinor,
          currency,
          is_enabled: isEnabled,
          updated_by: profile.id,
        })
        .eq("id", existing.id)
        .select("id")
        .single()
    : await supabase
        .from("lab_result_consult_prices")
        .insert({
          organisation_id: organisationId,
          amount_minor: amountMinor,
          currency,
          is_enabled: isEnabled,
          updated_by: profile.id,
        })
        .select("id")
        .single();

  if (error || !saved) {
    return { error: error?.message ?? "Could not save the price." };
  }

  const service = createServiceRoleClient();
  await service.from("audit_log").insert({
    actor_id: profile.id,
    organisation_id: organisationId ?? profile.organisation_id,
    action: "billing.lab_result_consult_price_change",
    entity_type: "lab_result_consult_prices",
    entity_id: saved.id,
    event: {
      organisation_id: organisationId,
      old_amount_minor: previous?.amount_minor ?? null,
      old_currency: previous?.currency ?? null,
      new_amount_minor: amountMinor,
      new_currency: currency,
      is_enabled: isEnabled,
    },
  });

  revalidatePath("/admin/settings/lab-result-consult-pricing");
  return {
    message: organisationId
      ? "Organisation override saved."
      : "Platform-default price saved.",
  };
}

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  createFundingProgramme,
  setFundingProgrammeStatus,
  type FundingProgrammeStatus,
} from "@/lib/ngo/funding-programmes";

export type NgoProgrammeActionState = { error?: string; message?: string } | undefined;

const createSchema = z.object({
  organisationId: z.string().uuid(),
  serviceProductId: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required").max(200),
  contractReference: z.string().trim().min(1, "Contract reference is required").max(200),
  fundedUnitCap: z.coerce.number().int().positive("Funded places must be a positive number"),
  priceKobo: z.coerce.number().int().nonnegative().optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
});

/**
 * Thin wrapper over public.create_funding_programme() -- the RPC is the real
 * authority (superadmin-only, org-must-be-ngo, product-must-be-active-NGN,
 * see 20260922184145_ngo_funded_cohort_schema.sql); this action only shapes
 * the form input and refreshes the page.
 */
export async function createNgoProgrammeAction(
  _prev: NgoProgrammeActionState,
  formData: FormData
): Promise<NgoProgrammeActionState> {
  const parsed = createSchema.safeParse({
    organisationId: formData.get("organisationId"),
    serviceProductId: formData.get("serviceProductId"),
    name: formData.get("name"),
    contractReference: formData.get("contractReference"),
    fundedUnitCap: formData.get("fundedUnitCap"),
    priceKobo: formData.get("priceKobo") || undefined,
    startsAt: formData.get("startsAt") || undefined,
    endsAt: formData.get("endsAt") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  try {
    await createFundingProgramme(supabase, {
      organisationId: parsed.data.organisationId,
      serviceProductId: parsed.data.serviceProductId,
      name: parsed.data.name,
      contractReference: parsed.data.contractReference,
      fundedUnitCap: parsed.data.fundedUnitCap,
      priceKobo: parsed.data.priceKobo,
      startsAt: parsed.data.startsAt,
      endsAt: parsed.data.endsAt,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the programme" };
  }

  revalidatePath("/admin/settings/ngo-programmes");
  return { message: `${parsed.data.name} created as a draft.` };
}

const statusSchema = z.object({
  programmeId: z.string().uuid(),
  status: z.enum(["active", "expired", "cancelled"] as const satisfies readonly FundingProgrammeStatus[]),
  note: z.string().trim().max(2000).optional(),
});

/** Thin wrapper over public.set_funding_programme_status(). */
export async function setNgoProgrammeStatusAction(
  _prev: NgoProgrammeActionState,
  formData: FormData
): Promise<NgoProgrammeActionState> {
  const parsed = statusSchema.safeParse({
    programmeId: formData.get("programmeId"),
    status: formData.get("status"),
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  try {
    await setFundingProgrammeStatus(supabase, parsed.data.programmeId, parsed.data.status, parsed.data.note);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not update the programme's status" };
  }

  revalidatePath("/admin/settings/ngo-programmes");
  return { message: `Status changed to ${parsed.data.status}.` };
}

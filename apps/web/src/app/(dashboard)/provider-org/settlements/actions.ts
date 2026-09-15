"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string } | undefined;

const createSchema = z.object({
  organisationId: z.string().uuid(),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  invoicedTotalKobo: z.coerce.number().int().min(0),
  reference: z.string().trim().max(100).optional(),
});

export async function createSettlementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = createSchema.safeParse({
    organisationId: formData.get("organisationId"),
    periodStart: formData.get("periodStart"),
    periodEnd: formData.get("periodEnd"),
    invoicedTotalKobo: formData.get("invoicedTotalKobo"),
    reference: formData.get("reference") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.from("provider_org_settlements").insert({
    organisation_id: parsed.data.organisationId,
    period_start: parsed.data.periodStart,
    period_end: parsed.data.periodEnd,
    invoiced_total_kobo: parsed.data.invoicedTotalKobo,
    reference: parsed.data.reference ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/provider-org/settlements");
  return { message: "Statement created." };
}

const statusSchema = z.object({
  settlementId: z.string().uuid(),
  status: z.enum(["draft", "issued", "disputed", "approved", "settled"]),
});

export async function setSettlementStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = statusSchema.safeParse({
    settlementId: formData.get("settlementId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("provider_org_settlements")
    .update({
      status: parsed.data.status,
      settled_at: parsed.data.status === "settled" ? now : null,
    })
    .eq("id", parsed.data.settlementId);
  if (error) return { error: error.message };

  revalidatePath("/provider-org/settlements");
  return { message: "Statement updated." };
}

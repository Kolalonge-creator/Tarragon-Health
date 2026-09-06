"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string } | undefined;

const createSchema = z.object({
  insurerId: z.string().uuid(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  planYear: z.coerce.number().int().min(2020).max(2100).optional(),
});

export async function createPayerPlanAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = createSchema.safeParse({
    insurerId: formData.get("insurerId"),
    code: formData.get("code"),
    name: formData.get("name"),
    planYear: formData.get("planYear") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase.from("payer_plans").insert({
    insurer_id: parsed.data.insurerId,
    code: parsed.data.code,
    name: parsed.data.name,
    plan_year: parsed.data.planYear ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/payer/plans");
  return { message: "Plan created." };
}

const statusSchema = z.object({
  planId: z.string().uuid(),
  status: z.enum(["draft", "active", "closed"]),
});

export async function setPayerPlanStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = statusSchema.safeParse({
    planId: formData.get("planId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("payer_plans")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.planId);
  if (error) return { error: error.message };

  revalidatePath("/payer/plans");
  return { message: "Plan updated." };
}

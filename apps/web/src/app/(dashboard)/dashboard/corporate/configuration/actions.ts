"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rpcLoose } from "@/lib/institution/rpc";

export type ConfigState = { error?: string; success?: boolean } | undefined;

const schema = z.object({
  pathways: z.array(z.string()).max(20),
  items: z.array(z.string()).max(40),
  campaigns: z.array(z.string().uuid()).max(40),
  budgetNaira: z.coerce.number().min(0).max(50_000_000),
  note: z.string().max(1000).optional(),
});

/** Sends a programme configuration request. Tarragon reviews it; nothing changes for members until it is approved and set up. */
export async function submitConfigRequestAction(_prev: ConfigState, form: FormData): Promise<ConfigState> {
  const parsed = schema.safeParse({
    pathways: form.getAll("pathways").map(String),
    items: form.getAll("items").map(String),
    campaigns: form.getAll("campaigns").map(String),
    budgetNaira: form.get("budget_naira") || 0,
    note: String(form.get("note") ?? ""),
  });
  if (!parsed.success) return { error: "Please check what you chose and try again." };
  const { error } = await rpcLoose("institution_config_submit", {
    p_pathways: parsed.data.pathways,
    p_item_codes: parsed.data.items,
    p_campaign_ids: parsed.data.campaigns,
    p_rewards_budget_kobo: Math.round(parsed.data.budgetNaira * 100),
    p_note: parsed.data.note ?? "",
  });
  if (error) {
    if (error.message.includes("not yet activated")) return { error: "This is not switched on yet." };
    if (error.message.includes("institution_config_invalid")) return { error: "Something you chose is not allowed. Choose at least one thing, and only from the lists." };
    return { error: "The request could not be sent. Please try again." };
  }
  revalidatePath("/dashboard/corporate/configuration");
  return { success: true };
}

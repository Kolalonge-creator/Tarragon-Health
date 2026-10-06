"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type CatalogueActionState = { error?: string; message?: string } | undefined;

const CODE = z.string().regex(/^[a-z][a-z0-9_]{2,63}$/);
const reason = z.string().trim().min(10, "Give a reason of at least 10 characters.").max(500);

const activeSchema = z.object({ code: CODE, active: z.enum(["true", "false"]), reason });
const priceSchema = z.object({
  code: CODE,
  // Naira typed by staff, whole naira only here; converted to integer kobo exactly (INV-15), never a float.
  naira: z.string().trim().regex(/^\d{1,9}$/, "Enter the price in whole naira, for example 100000."),
  startsOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date the price starts."),
  reason,
});

const MESSAGES: Readonly<Record<string, string>> = {
  catalogue_not_authorised: "Only an admin can change the catalogue.",
  catalogue_reason_needed: "Give a reason of at least 10 characters.",
  item_has_no_price: "This item has no price yet, so it cannot be switched on.",
  price_start_before_current: "The new price must start after the current price started.",
  price_components_must_sum: "The itemised split must add up to the price.",
  unknown_item: "That item no longer exists.",
};
function describe(error: { message: string }): string {
  for (const [k, v] of Object.entries(MESSAGES)) if (error.message.includes(k)) return v;
  return "That did not save. Please try again.";
}

/** Switches an item on or off. The database checks the caller is an admin, the reason, and that an item being switched on has a price. */
export async function setItemActive(_prev: CatalogueActionState, formData: FormData): Promise<CatalogueActionState> {
  const parsed = activeSchema.safeParse({ code: formData.get("code"), active: formData.get("active"), reason: formData.get("reason") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_catalog_item_active", { p_code: parsed.data.code, p_active: parsed.data.active === "true", p_reason: parsed.data.reason });
  if (error) return { error: describe(error) };
  revalidatePath("/admin/catalogue");
  return { message: parsed.data.active === "true" ? "Item switched on." : "Item switched off." };
}

/** Sets a new price from a date. The old price is closed, never edited, and every order keeps the price it was made at. */
export async function setItemPrice(_prev: CatalogueActionState, formData: FormData): Promise<CatalogueActionState> {
  const parsed = priceSchema.safeParse({ code: formData.get("code"), naira: formData.get("naira"), startsOn: formData.get("starts_on"), reason: formData.get("reason") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const kobo = Number(parsed.data.naira) * 100;
  if (!Number.isSafeInteger(kobo) || kobo <= 0) return { error: "Enter a price above zero." };
  // The price starts at the start of that day in Lagos (UTC+1, no daylight saving).
  const startsAt = new Date(`${parsed.data.startsOn}T00:00:00+01:00`);
  if (Number.isNaN(startsAt.getTime())) return { error: "Choose the date the price starts." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_item_price", { p_code: parsed.data.code, p_amount_kobo: kobo, p_components: {}, p_reason: parsed.data.reason, p_valid_from: startsAt.toISOString() });
  if (error) return { error: describe(error) };
  revalidatePath("/admin/catalogue");
  return { message: "Price saved." };
}

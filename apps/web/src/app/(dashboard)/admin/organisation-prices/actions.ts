"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { organisationPriceLimits } from "./limits";
import { createClient } from "@/lib/supabase/server";

export type OrganisationPriceActionState = { error?: string; message?: string } | undefined;

const reason = z.string().trim().min(10, "Give a reason of at least 10 characters.").max(500);
// Whole naira typed by staff, converted to integer kobo exactly (INV-15), never a float.
const naira = z.string().trim().regex(/^\d{1,9}$/, "Enter the price in whole naira, for example 100000.");
const day = z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, "Choose the date the price starts, or leave it empty to start now.");
const uuid = z.string().uuid();

const MESSAGES: Readonly<Record<string, string>> = {
  catalogue_not_authorised: "Only an admin can change organisation prices.",
  catalogue_reason_needed: "Give a reason of at least 10 characters.",
  organisation_price_out_of_range: "That price is outside the allowed band.",
  organisation_price_unknown_organisation: "Choose an employer or HMO organisation.",
  organisation_price_no_override: "That organisation has no price of its own to remove.",
  organisation_price_default_cannot_clear: "The default price cannot be removed, only changed.",
  price_start_before_current: "The new price must start after the price it replaces started.",
  unknown_item: "The Membership item no longer exists.",
};
function describe(error: { message: string }): string {
  for (const [k, v] of Object.entries(MESSAGES)) if (error.message.includes(k)) return v;
  return "That did not save. Please try again.";
}

function toKobo(nairaText: string): { kobo: number } | { error: string } {
  const kobo = Number(nairaText) * 100;
  if (!Number.isSafeInteger(kobo) || kobo <= 0) return { error: "Enter a price above zero." };
  const { minKobo, maxKobo } = organisationPriceLimits();
  if (kobo < minKobo || kobo > maxKobo) {
    return { error: `The price must be between ₦${(minKobo / 100).toLocaleString("en-NG")} and ₦${(maxKobo / 100).toLocaleString("en-NG")}.` };
  }
  return { kobo };
}

/** The price starts at the start of that day in Lagos (UTC+1, no daylight saving); no date means now. */
function startsAt(startsOn: string): string | { error: string } {
  const d = startsOn ? new Date(`${startsOn}T00:00:00+01:00`) : new Date();
  return Number.isNaN(d.getTime()) ? { error: "Choose the date the price starts, or leave it empty to start now." } : d.toISOString();
}

const setSchema = z.object({ organisationId: uuid.or(z.literal("")), naira, startsOn: day, reason });

/** Sets the price one organisation pays per Membership seat, or (no organisation) the default every organisation without its own pays. */
export async function setOrganisationPrice(_prev: OrganisationPriceActionState, formData: FormData): Promise<OrganisationPriceActionState> {
  const parsed = setSchema.safeParse({
    organisationId: formData.get("organisation_id") ?? "",
    naira: formData.get("naira"),
    startsOn: formData.get("starts_on") ?? "",
    reason: formData.get("reason"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const price = toKobo(parsed.data.naira);
  if ("error" in price) return price;
  const from = startsAt(parsed.data.startsOn);
  if (typeof from !== "string") return from;
  const supabase = await createClient();
  let error: { message: string } | null;
  if (parsed.data.organisationId) {
    ({ error } = await supabase.rpc("set_organisation_member_price", { p_employer_org: parsed.data.organisationId, p_amount_kobo: price.kobo, p_reason: parsed.data.reason, p_valid_from: from }));
  } else {
    ({ error } = await supabase.rpc("set_default_organisation_member_price", { p_amount_kobo: price.kobo, p_reason: parsed.data.reason, p_valid_from: from }));
  }
  if (error) return { error: describe(error) };
  revalidatePath("/admin/organisation-prices");
  return { message: parsed.data.organisationId ? "Organisation price saved." : "Default price saved." };
}

const clearSchema = z.object({ organisationId: uuid, startsOn: day, reason });

/** Puts one organisation back on the default price from a date. The override row is closed, never deleted. */
export async function clearOrganisationPrice(_prev: OrganisationPriceActionState, formData: FormData): Promise<OrganisationPriceActionState> {
  const parsed = clearSchema.safeParse({ organisationId: formData.get("organisation_id"), startsOn: formData.get("starts_on") ?? "", reason: formData.get("reason") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const from = startsAt(parsed.data.startsOn);
  if (typeof from !== "string") return from;
  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_organisation_member_price", { p_employer_org: parsed.data.organisationId, p_reason: parsed.data.reason, p_valid_from: from });
  if (error) return { error: describe(error) };
  revalidatePath("/admin/organisation-prices");
  return { message: "Back on the default price." };
}

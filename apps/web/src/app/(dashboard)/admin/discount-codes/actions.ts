"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Database } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";

export type DiscountCodeActionState = { error?: string; message?: string } | undefined;

type DiscountCodeArgs = {
  p_code: string | null; p_kind: "percent" | "fixed"; p_percent: number | null; p_fixed_kobo: number | null; p_max_discount_kobo: number | null;
  p_item_codes: string[]; p_cohort_id: string | null; p_max_total_uses: number; p_max_per_person: number; p_valid_from: string; p_valid_to: string; p_note: string | null;
  /** The only badge a code can carry today; part of what the code gives, fixed at creation. */
  p_badge: "founding_member" | null;
};

/** The database accepts A-Z and 0-9 only, 4 to 24 long; lower case is normalised there. Blank means "generate one for me". */
const code = z.string().trim().regex(/^([A-Za-z0-9]{4,24})?$/, "A code is 4 to 24 letters or digits, or blank to have one generated.");
const reason = z.string().trim().min(10, "Give a reason of at least 10 characters.").max(500);
const ITEM_CODE = z.string().regex(/^[a-z][a-z0-9_]{2,63}$/);
const DATE = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");

const createSchema = z
  .object({
    code,
    kind: z.enum(["percent", "fixed"]),
    // Whole numbers only: a percent of 1 to 100, or whole naira converted to integer kobo exactly (INV-15), never a float.
    percent: z.string().trim().regex(/^\d{0,3}$/, "Enter a whole percentage from 1 to 100.").optional(),
    naira: z.string().trim().regex(/^\d{0,9}$/, "Enter whole naira, for example 5000.").optional(),
    maxNaira: z.string().trim().regex(/^\d{0,9}$/, "Enter the cap in whole naira.").optional(),
    items: z.array(ITEM_CODE).max(50),
    cohortId: z.union([z.literal(""), z.string().uuid()]).optional(),
    maxTotalUses: z.string().trim().regex(/^\d{1,7}$/, "Enter how many times the code can be used in all, 1 to 1,000,000."),
    maxPerPerson: z.string().trim().regex(/^\d{1,3}$/, "Enter how many times one person can use it, 1 to 100."),
    validFrom: DATE,
    validTo: DATE,
    note: z.string().trim().max(500).optional(),
    // A checkbox: present means the code makes its paid beneficiaries founding members (founder decision 2026-11-04).
    badge: z.union([z.literal(""), z.literal("founding_member")]).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "percent") {
      const p = Number(v.percent ?? "");
      if (!Number.isInteger(p) || p < 1 || p > 100) ctx.addIssue({ code: "custom", path: ["percent"], message: "Enter a whole percentage from 1 to 100." });
    } else {
      const n = Number(v.naira ?? "");
      if (!Number.isInteger(n) || n <= 0) ctx.addIssue({ code: "custom", path: ["naira"], message: "Enter the amount off in whole naira, above zero." });
    }
  });

const statusSchema = z.object({ id: z.string().uuid(), status: z.enum(["active", "paused", "ended"]), reason });

const MESSAGES: Readonly<Record<string, string>> = {
  pricing_not_authorised: "Only an admin can manage discount codes.",
  catalogue_reason_needed: "Give a reason of at least 10 characters.",
  discount_code_taken: "That code is already in use. Choose another, or leave the code blank to have one generated.",
  discount_code_invalid: "That code is not valid: 4 to 24 letters or digits, dates in order, and a cohort of your organisation.",
  unknown_item: "One of the chosen items is not in the catalogue.",
  discount_code_immutable: "What a code gives cannot change once it exists. End it and create a new one.",
  founding_items_invalid: "A founding member code must be limited to exactly one item, the Membership (membership_annual_no_panel).",
  retired_item: "Membership Plus and the Plus upgrade are retired and no longer sold, so a code cannot include them.",
  founding_offer_exists: "A founding member code is already active. End it before creating another.",
  discount_codes_one_live_founding_offer: "A founding member code is already active, so this one cannot be resumed. End the other one first.",
  "violates check constraint": "Those values are outside what is allowed: percent 1 to 100, amounts above zero, uses 1 to 1,000,000 in all and 1 to 100 per person.",
};
function describe(error: { message: string }): string {
  for (const [k, v] of Object.entries(MESSAGES)) if (error.message.includes(k)) return v;
  return "That did not save. Please try again.";
}

/** Lagos is UTC+1 with no daylight saving: a code starts at the start of its first day and ends at the end of its last day there. */
const lagosStart = (d: string): Date => new Date(`${d}T00:00:00+01:00`);
const lagosEnd = (d: string): Date => new Date(`${d}T23:59:59+01:00`);

/**
 * Creates a Membership-checkout discount code. The database checks the caller is an admin, that any item codes and cohort are
 * the organisation's own, keeps what the code gives immutable from then on, and writes the audit row.
 */
export async function createDiscountCode(_prev: DiscountCodeActionState, formData: FormData): Promise<DiscountCodeActionState> {
  const parsed = createSchema.safeParse({
    code: formData.get("code") ?? "",
    kind: formData.get("kind"),
    percent: formData.get("percent") ?? "",
    naira: formData.get("naira") ?? "",
    maxNaira: formData.get("max_naira") ?? "",
    items: formData.getAll("item"),
    cohortId: formData.get("cohort_id") ?? "",
    maxTotalUses: formData.get("max_total_uses"),
    maxPerPerson: formData.get("max_per_person"),
    validFrom: formData.get("valid_from"),
    validTo: formData.get("valid_to"),
    note: formData.get("note") ?? "",
    badge: formData.get("badge") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const v = parsed.data;
  const from = lagosStart(v.validFrom);
  const to = lagosEnd(v.validTo);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return { error: "Choose the dates the code runs." };
  if (to.getTime() <= from.getTime()) return { error: "The last day must be on or after the first day." };
  const maxTotal = Number(v.maxTotalUses);
  const maxPer = Number(v.maxPerPerson);
  if (maxTotal < 1 || maxTotal > 1_000_000) return { error: "Enter how many times the code can be used in all, 1 to 1,000,000." };
  if (maxPer < 1 || maxPer > 100) return { error: "Enter how many times one person can use it, 1 to 100." };
  const fixedKobo = v.kind === "fixed" ? Number(v.naira) * 100 : null;
  const maxKobo = v.maxNaira ? Number(v.maxNaira) * 100 : null;
  if (fixedKobo !== null && !Number.isSafeInteger(fixedKobo)) return { error: "Enter the amount off in whole naira." };
  if (maxKobo !== null && (!Number.isSafeInteger(maxKobo) || maxKobo <= 0)) return { error: "Enter the cap in whole naira, above zero, or leave it blank." };

  const supabase = await createClient();
  // The function has no parameter defaults, so the generated types mark every argument required; the optional ones (code, percent or
  // amount, cap, cohort, note) are genuinely nullable in SQL and must arrive as JSON null, not be left out, so the cast is to send null.
  const args: DiscountCodeArgs = {
    p_code: v.code || null,
    p_kind: v.kind,
    p_percent: v.kind === "percent" ? Number(v.percent) : null,
    p_fixed_kobo: fixedKobo,
    p_max_discount_kobo: maxKobo,
    p_item_codes: v.items,
    p_cohort_id: v.cohortId || null,
    p_max_total_uses: maxTotal,
    p_max_per_person: maxPer,
    p_valid_from: from.toISOString(),
    p_valid_to: to.toISOString(),
    p_note: v.note || null,
    p_badge: v.badge === "founding_member" ? "founding_member" : null,
  };
  const { data, error } = await supabase.rpc("admin_create_discount_code", args as unknown as Database["public"]["Functions"]["admin_create_discount_code"]["Args"]);
  if (error) return { error: describe(error) };
  revalidatePath("/admin/discount-codes");
  const made = (data as { code?: string } | null)?.code;
  return { message: made ? `Code ${made} created.` : "Code created." };
}

/** Pauses, resumes or ends a code. Ending brings its last day forward to now; what it gives never changes. */
export async function setDiscountCodeStatus(_prev: DiscountCodeActionState, formData: FormData): Promise<DiscountCodeActionState> {
  const parsed = statusSchema.safeParse({ id: formData.get("id"), status: formData.get("status"), reason: formData.get("reason") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_discount_code_status", { p_id: parsed.data.id, p_status: parsed.data.status, p_reason: parsed.data.reason });
  if (error) return { error: describe(error) };
  revalidatePath("/admin/discount-codes");
  const said: Record<typeof parsed.data.status, string> = { active: "Code is active again.", paused: "Code paused.", ended: "Code ended." };
  return { message: said[parsed.data.status] };
}

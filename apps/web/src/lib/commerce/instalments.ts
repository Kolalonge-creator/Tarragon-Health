import { z } from "zod";

/**
 * Paying the yearly Membership in parts (S25b, behind the platform module `membership_instalments`, which is OFF until the founder and
 * counsel say otherwise; see docs/design/S25b.md). Every shape is parsed, never trusted. Money is integer kobo. The database makes every
 * number (the schedule, the amount of each part, which part is next); this file only reads them, and mirrors how the parts are split so a
 * screen can show the plan before it exists.
 */
const kobo = z.number().int().nonnegative();

export const instalmentPolicySchema = z.object({
  parts: z.number().int().min(2).max(12),
  due_offsets_days: z.array(z.number().int().nonnegative()).min(2),
  grace_days: z.number().int().nonnegative(),
  reminder_days_before: z.array(z.number().int().nonnegative()),
  open: z.boolean(),
});
export type InstalmentPolicy = z.infer<typeof instalmentPolicySchema>;

/** A reply that is not understood means "not offered": the screen never shows a plan it cannot describe. */
export function parseInstalmentPolicy(data: unknown): InstalmentPolicy | null {
  const r = instalmentPolicySchema.safeParse(data);
  if (!r.success) return null;
  if (r.data.due_offsets_days.length !== r.data.parts) return null;
  return r.data;
}

/**
 * The same split the database makes: equal parts in whole kobo, the leftover kobo on the FIRST part, so the parts add up to the price exactly.
 * Used only to SHOW the plan before it is created; the amount that is charged is always the database's.
 */
export function splitIntoParts(priceKobo: number, parts: number): number[] {
  if (!Number.isInteger(priceKobo) || priceKobo <= 0 || !Number.isInteger(parts) || parts < 1) return [];
  const base = Math.floor(priceKobo / parts);
  const rest = priceKobo - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i === 0 ? rest : 0));
}

export const INSTALMENT_PLAN_STATES = ["awaiting_first", "active", "lapsed", "completed", "cancelled"] as const;
export type InstalmentPlanState = (typeof INSTALMENT_PLAN_STATES)[number];

export const instalmentRowSchema = z.object({
  id: z.string(),
  seq: z.number().int().positive(),
  amount_kobo: kobo,
  due_at: z.string().nullable(),
  state: z.enum(["pending", "paid", "cancelled"]),
  paid_at: z.string().nullable(),
  overdue: z.boolean().optional().default(false),
});
export type InstalmentRow = z.infer<typeof instalmentRowSchema>;

export const instalmentPlanSchema = z.object({
  plan_id: z.string(),
  order_id: z.string(),
  state: z.enum(INSTALMENT_PLAN_STATES),
  parts: z.number().int().positive(),
  price_kobo: kobo,
  paid_kobo: kobo,
  grace_days: z.number().int().nonnegative().nullable().optional().default(null),
  first_paid_at: z.string().nullable().optional().default(null),
  lapsed_at: z.string().nullable().optional().default(null),
  access_ends_at: z.string().nullable().optional().default(null),
  name_key: z.string(),
  is_buyer: z.boolean().optional().default(true),
  next_instalment_id: z.string().nullable().optional().default(null),
  instalments: z.array(instalmentRowSchema).nullable().optional().default([]),
});
export type InstalmentPlan = Omit<z.infer<typeof instalmentPlanSchema>, "instalments"> & { instalments: InstalmentRow[] };

/** Bad plans are dropped one by one; the rest still show. */
export function parseInstalmentPlans(data: unknown): InstalmentPlan[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = instalmentPlanSchema.safeParse(row);
    return r.success ? [{ ...r.data, instalments: r.data.instalments ?? [] }] : [];
  });
}

/** The reply of order-checkout for a part: the hosted page to open. */
export const payInstalmentReplySchema = z.object({ order_id: z.string(), instalment_id: z.string(), reference: z.string(), amount_kobo: kobo, checkout_url: z.string().url() });

/** Plans a patient still has something to do about, newest first. A finished or closed plan stays in the history, not in front of them. */
export function openPlans(plans: readonly InstalmentPlan[]): InstalmentPlan[] {
  return plans.filter((p) => p.state === "active" || p.state === "lapsed" || p.state === "awaiting_first");
}

/** The part to pay next, if this person may pay it (only the buyer pays). */
export function nextPart(plan: InstalmentPlan): InstalmentRow | null {
  if (!plan.is_buyer || plan.next_instalment_id === null) return null;
  return plan.instalments.find((i) => i.id === plan.next_instalment_id && i.state === "pending") ?? null;
}

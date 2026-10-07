import { z } from "zod";
import type { MessageKey } from "@tarragon/i18n";

/**
 * What the Membership screen reads from the database (S25). Every shape is parsed, never trusted: a reply that does not
 * match is treated as "nothing to show" rather than rendered half-wrong. Money is integer kobo (INV-15) and is only
 * formatted for display (`formatNaira` in @tarragon/commerce).
 */
const kobo = z.number().int().nonnegative();

export const CATALOGUE_KINDS = ["consultation", "care_pack", "lab_panel", "membership", "home_kit"] as const;
export type CatalogueKind = (typeof CATALOGUE_KINDS)[number];

export const catalogueItemSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
  kind: z.enum(CATALOGUE_KINDS),
  name_key: z.string(),
  description_key: z.string(),
  included_keys: z.array(z.string()),
  duration_days: z.number().int().positive().nullable(),
  uses: z.number().int().positive().nullable(),
  amount_kobo: kobo.refine((n) => n > 0),
  components: z.record(z.string(), z.number().int().nonnegative()),
});
export type CatalogueItem = z.infer<typeof catalogueItemSchema>;

export const ORDER_STATES = ["created", "paid", "failed", "refunded", "cancelled"] as const;
export const orderRowSchema = z.object({
  order_id: z.string(),
  state: z.enum(ORDER_STATES),
  amount_kobo: kobo,
  fee_kobo: kobo.nullable(),
  total_kobo: kobo.nullable(),
  code: z.string(),
  name_key: z.string(),
  created_at: z.string(),
  paid_at: z.string().nullable(),
  // S71: what a sponsor covered, and who. A fully covered order has amount 0 and no payment.
  sponsor_share_kobo: kobo.optional().default(0),
  sponsor_name: z.string().nullable().optional().default(null),
});
export type OrderRow = z.infer<typeof orderRowSchema>;

export const membershipSchema = z.object({ is_member: z.boolean(), ends_at: z.string().nullable(), source: z.string().nullable() });
export type MembershipState = z.infer<typeof membershipSchema>;

export const payReplySchema = z.object({ order_id: z.string(), reference: z.string(), amount_kobo: kobo, checkout_url: z.string().url() });
/** S71: a sponsor pays the whole order. There is no checkout link and no payment step; the order is already paid. */
export const coveredReplySchema = z.object({ covered: z.literal(true), order_id: z.string(), reference: z.string(), sponsor_name: z.string().nullable().optional().default(null) });
export const checkoutReplySchema = z.union([coveredReplySchema, payReplySchema]);
export type CheckoutReply = z.infer<typeof checkoutReplySchema>;
export const isCoveredReply = (r: CheckoutReply): r is z.infer<typeof coveredReplySchema> => "covered" in r;

export const HMO_RESULTS = ["pending_manual", "eligible", "not_eligible"] as const;
export const hmoReplySchema = z.object({ check_id: z.string(), result: z.enum(HMO_RESULTS) });
export const hmoPlanSchema = z.object({ hmo_id: z.string(), name: z.string() });
export const hmoCheckRowSchema = z.object({ check_id: z.string(), hmo_name: z.string(), result: z.enum(HMO_RESULTS), checked_at: z.string(), decided_at: z.string().nullable() });
export type HmoCheckRow = z.infer<typeof hmoCheckRowSchema>;
export type HmoPlan = z.infer<typeof hmoPlanSchema>;
export function parseHmoPlans(data: unknown): HmoPlan[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => { const r = hmoPlanSchema.safeParse(row); return r.success ? [r.data] : []; });
}
export function parseHmoChecks(data: unknown): HmoCheckRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => { const r = hmoCheckRowSchema.safeParse(row); return r.success ? [r.data] : []; });
}
export const verifyReplySchema = z.object({ state: z.enum(ORDER_STATES), outcome: z.string() });

/** Items that are bad rows are dropped one by one; the rest still show. */
export function parseCatalogue(data: unknown): CatalogueItem[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = catalogueItemSchema.safeParse(row);
    return r.success ? [r.data] : [];
  });
}
export function parseOrders(data: unknown): OrderRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) => {
    const r = orderRowSchema.safeParse(row);
    return r.success ? [r.data] : [];
  });
}
export function parseMembership(data: unknown): MembershipState {
  const r = membershipSchema.safeParse(data);
  return r.success ? r.data : { is_member: false, ends_at: null, source: null };
}

/** Catalogue copy keys come from the database; an unknown key falls back to showing nothing rather than a raw key. */
export function isMessageKey(key: string, known: Readonly<Record<string, string>>): key is MessageKey {
  return Object.hasOwn(known, key);
}

const ERROR_KEYS: Readonly<Record<string, MessageKey>> = {
  checkout_not_open: "shop.error.checkout_not_open",
  item_not_available: "shop.error.item_not_available",
  already_member: "shop.error.already_member",
  no_capacity: "shop.error.no_capacity",
  too_many_open_orders: "shop.error.too_many_open_orders",
  email_needed: "shop.error.email_needed",
  payment_unavailable: "shop.error.payment_unavailable",
  checkout_link_lost: "shop.error.checkout_link_lost",
  already_paid: "shop.error.already_paid",
  order_closed: "shop.error.order_closed",
  order_beneficiary_not_allowed: "shop.error.order_beneficiary_not_allowed",
  gift_item_not_allowed: "shop.error.gift_item_not_allowed",
  membership_not_open: "shop.error.membership_not_open",
  quote_changed: "shop.error.quote_changed",
  sponsor_billing_not_open: "shop.error.sponsor_billing_not_open",
  order_fully_covered: "shop.error.order_fully_covered",
  discount_code_invalid: "shop.error.discount_code_invalid",
  discount_code_rate_limited: "shop.error.discount_code_rate_limited",
  sponsor_budget_exhausted: "shop.error.sponsor_budget_exhausted",
  sponsor_payment_not_open: "shop.error.sponsor_payment_not_open",
};

const HMO_ERROR_KEYS: Readonly<Record<string, MessageKey>> = {
  hmo_not_available: "hmo.error.hmo_not_available",
  hmo_check_rate_limited: "hmo.error.hmo_check_rate_limited",
  sponsor_payment_not_open: "hmo.error.sponsor_payment_not_open",
  member_number_invalid: "hmo.error.member_number_invalid",
  hmo_not_configured: "hmo.error.hmo_not_configured",
};
export function hmoErrorKey(code: unknown): MessageKey {
  return (typeof code === "string" ? HMO_ERROR_KEYS[code] : undefined) ?? "hmo.error.unknown";
}
/** The i18n key for a checkout error code from order-checkout. Anything unrecognised is the generic message. */
export function checkoutErrorKey(code: unknown): MessageKey {
  return (typeof code === "string" ? ERROR_KEYS[code] : undefined) ?? "shop.error.unknown";
}

const STATE_KEYS: Readonly<Record<(typeof ORDER_STATES)[number], MessageKey>> = {
  created: "shop.history.state.created",
  paid: "shop.history.state.paid",
  failed: "shop.history.state.failed",
  refunded: "shop.history.state.refunded",
  cancelled: "shop.history.state.cancelled",
};
export const orderStateKey = (s: (typeof ORDER_STATES)[number]): MessageKey => STATE_KEYS[s];

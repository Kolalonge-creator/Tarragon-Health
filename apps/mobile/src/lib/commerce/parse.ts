import type { MessageKey } from "@tarragon/i18n";

/**
 * What the Membership section reads (S25). Parsed by hand and never trusted: a row that does not match is dropped, and a
 * reply that is not what was expected means "nothing to show". Money is integer kobo (INV-15), formatted only for display.
 */
export interface CatalogueItem {
  code: string;
  kind: "consultation" | "care_pack" | "lab_panel" | "membership";
  nameKey: string;
  descriptionKey: string;
  includedKeys: string[];
  amountKobo: number;
}
export interface OrderRow {
  orderId: string;
  state: "created" | "paid" | "failed" | "refunded" | "cancelled";
  amountKobo: number;
  totalKobo: number | null;
  nameKey: string;
  createdAt: string;
  paidAt: string | null;
}
export interface MembershipState {
  isMember: boolean;
  endsAt: string | null;
}

const KINDS = ["consultation", "care_pack", "lab_panel", "membership"] as const;
const STATES = ["created", "paid", "failed", "refunded", "cancelled"] as const;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isKobo = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const str = (x: unknown): x is string => typeof x === "string";

export function parseCatalogue(data: unknown): CatalogueItem[] {
  if (!Array.isArray(data)) return [];
  const out: CatalogueItem[] = [];
  for (const r of data) {
    if (!isObj(r)) continue;
    const kind = KINDS.find((k) => k === r["kind"]);
    if (!kind || !str(r["code"]) || !/^[a-z][a-z0-9_]{2,63}$/.test(r["code"]) || !str(r["name_key"]) || !str(r["description_key"])) continue;
    if (!isKobo(r["amount_kobo"]) || r["amount_kobo"] === 0) continue;
    const included = Array.isArray(r["included_keys"]) ? r["included_keys"].filter(str) : [];
    out.push({ code: r["code"], kind, nameKey: r["name_key"], descriptionKey: r["description_key"], includedKeys: included, amountKobo: r["amount_kobo"] });
  }
  return out;
}

export function parseOrders(data: unknown): OrderRow[] {
  if (!Array.isArray(data)) return [];
  const out: OrderRow[] = [];
  for (const r of data) {
    if (!isObj(r)) continue;
    const state = STATES.find((s) => s === r["state"]);
    if (!state || !str(r["order_id"]) || !isKobo(r["amount_kobo"]) || r["amount_kobo"] === 0 || !str(r["name_key"]) || !str(r["created_at"])) continue;
    out.push({
      orderId: r["order_id"], state, amountKobo: r["amount_kobo"], totalKobo: isKobo(r["total_kobo"]) ? r["total_kobo"] : null,
      nameKey: r["name_key"], createdAt: r["created_at"], paidAt: str(r["paid_at"]) ? r["paid_at"] : null,
    });
  }
  return out;
}

export function parseMembership(data: unknown): MembershipState {
  if (!isObj(data) || data["is_member"] !== true) return { isMember: false, endsAt: null };
  return { isMember: true, endsAt: str(data["ends_at"]) ? data["ends_at"] : null };
}

export function parseCheckout(data: unknown): { reference: string; checkoutUrl: string } | null {
  if (!isObj(data) || !str(data["reference"]) || !str(data["checkout_url"])) return null;
  // Only an https link is ever opened.
  return data["checkout_url"].startsWith("https://") ? { reference: data["reference"], checkoutUrl: data["checkout_url"] } : null;
}

export function parseVerify(data: unknown): { state: OrderRow["state"]; outcome: string } | null {
  if (!isObj(data)) return null;
  const state = STATES.find((s) => s === data["state"]);
  return state && str(data["outcome"]) ? { state, outcome: data["outcome"] } : null;
}

const ERROR_KEYS: Readonly<Record<string, MessageKey>> = {
  checkout_not_open: "shop.error.checkout_not_open", item_not_available: "shop.error.item_not_available", already_member: "shop.error.already_member",
  no_capacity: "shop.error.no_capacity", too_many_open_orders: "shop.error.too_many_open_orders", email_needed: "shop.error.email_needed",
  payment_unavailable: "shop.error.payment_unavailable", checkout_link_lost: "shop.error.checkout_link_lost", already_paid: "shop.error.already_paid",
  order_closed: "shop.error.order_closed",
};
export function checkoutErrorKey(code: unknown): MessageKey {
  return (typeof code === "string" ? ERROR_KEYS[code] : undefined) ?? "shop.error.unknown";
}
/** A refusal is final for this tap (make a new key next time); a network or payment-partner failure keeps the key so a retry is the same order. */
export const keepsRetryKey = (code: string): boolean => code === "unknown" || code === "payment_unavailable";

const STATE_KEYS: Readonly<Record<OrderRow["state"], MessageKey>> = {
  created: "shop.history.state.created", paid: "shop.history.state.paid", failed: "shop.history.state.failed",
  refunded: "shop.history.state.refunded", cancelled: "shop.history.state.cancelled",
};
export const orderStateKey = (s: OrderRow["state"]): MessageKey => STATE_KEYS[s];

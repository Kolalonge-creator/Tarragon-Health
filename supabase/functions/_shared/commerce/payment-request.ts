/**
 * Payment requests (S72, function 19.13): a person asks a supporter to pay for one item, from a link shared through the phone's own share sheet.
 * The database decides everything (public.create_payment_request, payment_request_preview, create_request_order). This file holds the pure parts both
 * apps share: the shape of a code, the link, the words, and the parsing of what the database returns.
 *
 * INV-07: the link page and the share message carry only a generic item name and the amount. Never a condition, a reason or a person's health.
 */
export const PAYMENT_REQUEST_CODE = /^pr_[A-Za-z0-9_-]{24}$/;
export const isPaymentRequestCode = (v: unknown): v is string => typeof v === "string" && PAYMENT_REQUEST_CODE.test(v);

/** The link to share. `base` is the platform's own address (configuration), never anything the person typed. */
export function paymentRequestLink(base: string, code: string): string {
  if (!isPaymentRequestCode(code)) throw new Error("payment_request_code_invalid");
  return `${base.replace(/\/+$/, "")}/checkout/${code}`;
}

export type PaymentRequestStatus = "open" | "pending_payment" | "paid" | "cancelled" | "expired";
const STATUSES: readonly PaymentRequestStatus[] = ["open", "pending_payment", "paid", "cancelled", "expired"];

export interface PaymentRequestRow {
  readonly id: string;
  readonly itemCode: string;
  readonly nameKey: string;
  readonly status: PaymentRequestStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly paidAt: string | null;
}

export function parsePaymentRequests(raw: unknown): PaymentRequestRow[] {
  if (!Array.isArray(raw)) return [];
  const out: PaymentRequestRow[] = [];
  for (const r of raw) {
    if (typeof r !== "object" || r === null) continue;
    const x = r as Record<string, unknown>;
    if (typeof x["id"] !== "string" || typeof x["item_code"] !== "string" || typeof x["name_key"] !== "string" || typeof x["created_at"] !== "string" || typeof x["expires_at"] !== "string") continue;
    if (!STATUSES.includes(x["status"] as PaymentRequestStatus)) continue;
    out.push({
      id: x["id"], itemCode: x["item_code"], nameKey: x["name_key"], status: x["status"] as PaymentRequestStatus,
      createdAt: x["created_at"], expiresAt: x["expires_at"], paidAt: typeof x["paid_at"] === "string" ? x["paid_at"] : null,
    });
  }
  return out;
}

export interface CreatedPaymentRequest { readonly requestId: string; readonly code: string; readonly expiresAt: string }
export function parseCreatedPaymentRequest(raw: unknown): CreatedPaymentRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const x = raw as Record<string, unknown>;
  if (typeof x["request_id"] !== "string" || !isPaymentRequestCode(x["code"]) || typeof x["expires_at"] !== "string") return null;
  return { requestId: x["request_id"], code: x["code"], expiresAt: x["expires_at"] };
}

export type PreviewStatus = "open" | "expired" | "cancelled" | "paid" | "pending_payment" | "unknown" | "unavailable" | "rate_limited";
const PREVIEW_STATUSES: readonly PreviewStatus[] = ["open", "expired", "cancelled", "paid", "pending_payment", "unknown", "unavailable", "rate_limited"];

export type PaymentRequestPreview =
  | { readonly status: "open"; readonly nameKey: string; readonly amountKobo: number; readonly components: Readonly<Record<string, number>>; readonly expiresAt: string }
  | { readonly status: Exclude<PreviewStatus, "open"> };

/** Anything unreadable is "unknown", the same answer as a code that does not exist. */
export function parsePreview(raw: unknown): PaymentRequestPreview {
  if (typeof raw !== "object" || raw === null) return { status: "unknown" };
  const x = raw as Record<string, unknown>;
  const s = x["status"];
  if (!PREVIEW_STATUSES.includes(s as PreviewStatus)) return { status: "unknown" };
  if (s !== "open") return { status: s as Exclude<PreviewStatus, "open"> };
  const amount = x["amount_kobo"];
  if (typeof x["name_key"] !== "string" || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0 || typeof x["expires_at"] !== "string") return { status: "unknown" };
  const comps: Record<string, number> = {};
  const c = x["components"];
  if (typeof c === "object" && c !== null) for (const [k, v] of Object.entries(c)) if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) comps[k] = v;
  return { status: "open", nameKey: x["name_key"], amountKobo: amount, components: comps, expiresAt: x["expires_at"] };
}

/** What the page says for each state a link can be in. The same wording whether the code never existed or has been used (it is not a lookup service). */
export function previewMessageKey(status: Exclude<PreviewStatus, "open">): string {
  switch (status) {
    case "expired": return "request.page.expired";
    case "cancelled": return "request.page.cancelled";
    case "paid": return "request.page.paid";
    case "pending_payment": return "request.page.in_progress";
    case "rate_limited": return "request.page.rate_limited";
    case "unavailable": return "request.page.unavailable";
    default: return "request.page.unknown";
  }
}

const REQUEST_ERRORS = [
  "request_not_found", "request_expired", "request_cancelled", "request_used", "request_in_use", "request_own", "request_not_payable", "request_order_mismatch",
] as const;
export const REQUEST_ERROR_CODES = REQUEST_ERRORS;
export function requestErrorKey(code: string): string {
  switch (code) {
    case "request_expired": return "request.error.expired";
    case "request_cancelled": return "request.error.cancelled";
    case "request_used": return "request.error.used";
    case "request_in_use": return "request.error.in_use";
    case "request_own": return "request.error.own";
    case "request_not_payable": return "request.error.not_payable";
    case "already_member": return "request.error.already_member";
    case "gift_item_not_allowed": return "request.error.item_not_allowed";
    case "too_many_requests": return "request.error.too_many";
    case "checkout_not_open": return "shop.error.checkout_not_open";
    default: return "request.error.unknown";
  }
}

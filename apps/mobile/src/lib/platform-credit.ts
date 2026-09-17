import { fetchPlatformCreditBalance, postPlatformCreditTopupIntent, postPlatformCreditSpend } from "./api";
import { supabase } from "./supabase";
import type { QueryResult } from "./medications";

export interface PlatformCreditLedgerEntry {
  id: string;
  entry_type: string;
  amount_kobo: number;
  description: string | null;
  created_at: string;
}

export interface PlatformCreditConfig {
  min_topup_kobo: number;
  max_topup_kobo: number;
  suggested_amounts_kobo: number[];
}

export interface PlatformCreditState {
  balanceKobo: number;
  paidBalanceKobo: number;
  promoBalanceKobo: number;
  config: PlatformCreditConfig | null;
  ledger: PlatformCreditLedgerEntry[];
}

const DEFAULT_SUGGESTED_AMOUNTS_KOBO = [1000000, 2000000, 5000000, 10000000];

export const PLATFORM_CREDIT_ENTRY_LABEL: Record<string, string> = {
  topup: "Added to balance",
  admin_grant: "Credit granted",
  spend: "Spent",
  admin_correction: "Adjustment",
};

/**
 * "Your platform credit" — mirrors apps/web/src/components/platform-credit-card.tsx:
 * a general-purpose prepaid balance (split paid/promo under the hood,
 * shown combined here exactly like the web card), funded once via Paystack
 * and spent on any service_products purchase whenever the patient is ready.
 * Unlike a care voucher (an entitlement to one named service), this is a
 * general balance.
 *
 * Started as read-only (balance/top-up foundation only). Spending is now
 * wired in too — see trySpendPlatformCreditForService below, which the five
 * credit-gated screens (second opinion, senior case review, verified
 * documents, ask a doctor, confidential message) call to settle a request's
 * credit in-app instead of bouncing out to the browser.
 */
export async function loadPlatformCreditState(): Promise<QueryResult<PlatformCreditState>> {
  const result = await fetchPlatformCreditBalance();
  if (result.error || !result.success) {
    return { ok: false, error: result.error ?? "Could not load your platform credit" };
  }
  return {
    ok: true,
    data: {
      balanceKobo: result.balance_kobo ?? 0,
      paidBalanceKobo: result.paid_balance_kobo ?? 0,
      promoBalanceKobo: result.promo_balance_kobo ?? 0,
      config: result.config ?? null,
      ledger: result.ledger ?? [],
    },
  };
}

export function platformCreditSuggestedAmountsKobo(config: PlatformCreditConfig | null): number[] {
  return config?.suggested_amounts_kobo ?? DEFAULT_SUGGESTED_AMOUNTS_KOBO;
}

/**
 * Starts a top-up and returns the Paystack checkout URL for the caller to
 * open via WebBrowser.openBrowserAsync — same "open the checkout, then
 * refresh on return" idiom as services-screen.tsx's openServicesPage, never
 * a second checkout implementation on this side. Crediting the balance
 * still only ever happens server-side once the webhook confirms payment.
 */
export async function startPlatformCreditTopup(amountKobo: number): Promise<QueryResult<string>> {
  const result = await postPlatformCreditTopupIntent(amountKobo);
  if (result.error || !result.checkoutUrl) {
    return { ok: false, error: result.error ?? "Could not start this top-up" };
  }
  return { ok: true, data: result.checkoutUrl };
}

/**
 * The NGN price of a service_products row, read directly (service_products
 * is authenticated-readable per its RLS — same direct-query pattern
 * services.ts's loadServicesState already uses, not a second passthrough
 * route just for a price lookup). Null (not an error) means the product
 * doesn't exist or isn't active, which the caller should treat the same as
 * "can't tell you this is covered" rather than a hard failure.
 */
export async function getServiceProductPriceKobo(
  serviceProductCode: string
): Promise<QueryResult<number | null>> {
  const { data, error } = await supabase
    .from("service_products")
    .select("price_kobo")
    .eq("code", serviceProductCode)
    .eq("is_active", true)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data?.price_kobo ?? null };
}

export interface ServiceCreditSpendOutcome {
  /** true once the credit has actually been spent — the caller's own
   * insert (second_opinion_requests, async_consults, etc.) should be
   * (re)tried right after this, in-app, with no browser trip. */
  spent: boolean;
  /** Set when spent is false only because the balance was short — lets the
   * caller show exactly how much more is needed, same as
   * pay-with-credit-or-card.tsx's shortfall message on web. Absent for any
   * other reason (couldn't load the price/balance, a request-level error,
   * or the purchase turning out not to be payable any more). */
  shortfallKobo?: number;
  /** Set whenever spent is false for a reason other than a plain shortfall
   * — surfaced to the patient alongside the existing "buy a credit in the
   * browser" fallback so a real failure (not just "not enough yet") isn't
   * silently swallowed. */
  error?: string;
}

/**
 * Called after a credit-gated insert is rejected for lack of a credit (the
 * screen's own `..._CREDIT_REQUIRED_MARKER` match). Checks whether the
 * patient's platform credit balance already covers this product's price
 * and, if so, spends it right here — mirrors
 * apps/web/src/components/billing/pay-with-credit-or-card.tsx's
 * enough/short decision, just entered from the "insert already failed"
 * side instead of a plain balance display, since none of these five mobile
 * screens show product pricing up front today. Never throws: every
 * failure path (couldn't load price/balance, short balance, spend
 * refused/erred) comes back as spent: false so the caller's existing
 * WebBrowser.openBrowserAsync fallback still applies unchanged.
 */
export async function trySpendPlatformCreditForService(
  serviceProductCode: string,
  patientId?: string
): Promise<ServiceCreditSpendOutcome> {
  const priceResult = await getServiceProductPriceKobo(serviceProductCode);
  if (!priceResult.ok) return { spent: false, error: priceResult.error };
  if (priceResult.data === null) {
    return { spent: false, error: "This isn't available to buy right now." };
  }
  const priceKobo = priceResult.data;

  const balanceResult = await loadPlatformCreditState();
  if (!balanceResult.ok) return { spent: false, error: balanceResult.error };
  if (balanceResult.data.balanceKobo < priceKobo) {
    return { spent: false, shortfallKobo: priceKobo - balanceResult.data.balanceKobo };
  }

  const spendResult = await postPlatformCreditSpend(serviceProductCode, { patientId });
  if (spendResult.error) return { spent: false, error: spendResult.error };
  if (spendResult.ok === false) {
    if (spendResult.reason === "insufficient_balance") {
      return { spent: false, shortfallKobo: spendResult.shortfall_kobo ?? priceKobo };
    }
    return { spent: false, error: "This can no longer be paid for — try again." };
  }
  return { spent: true };
}

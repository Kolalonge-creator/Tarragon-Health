import {
  fetchPlatformCreditBalance,
  postPlatformCreditTopupIntent,
  postPlatformCreditSpend,
  type PayServicePurchaseWithCreditResult,
} from "./api";
import type { QueryResult } from "./medications";

export type { PayServicePurchaseWithCreditResult } from "./api";

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
 * Balance/top-up, plus spendPlatformCreditOnService below for the direct
 * purchase flows that prefer paying from this balance over the browser
 * hand-off when it covers the price (see services-screen.tsx,
 * payment-issue-card.tsx).
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
 * Buys serviceProductCode entirely out of the caller's platform credit
 * balance — no browser hand-off. Callers should only invoke this once
 * they've already confirmed the balance covers the price (see
 * hasEnoughPlatformCredit below); this still returns a proper
 * `insufficient_balance` result rather than throwing if that check raced
 * with something else spending the balance in the meantime, so callers
 * should fall back to their existing browser checkout on any !ok result.
 */
export async function spendPlatformCreditOnService(
  serviceProductCode: string
): Promise<QueryResult<PayServicePurchaseWithCreditResult>> {
  const result = await postPlatformCreditSpend(serviceProductCode);
  if (result.error || !result.result) {
    return { ok: false, error: result.error ?? "Could not complete this purchase" };
  }
  return { ok: true, data: result.result };
}

/** Whether a balance already on hand (e.g. from loadPlatformCreditState)
 * covers a given price — the shared "does in-app credit cover this" check
 * every direct-purchase screen runs before choosing credit over the browser
 * hand-off. A zero price (nothing left to pay) always counts as covered. */
export function hasEnoughPlatformCredit(balanceKobo: number, priceKobo: number): boolean {
  return priceKobo <= 0 || balanceKobo >= priceKobo;
}

/**
 * platform-credit.ts is a thin domain layer over the api.ts passthrough
 * wrappers (fetchPlatformCreditBalance / postPlatformCreditTopupIntent /
 * postPlatformCreditSpend) — these tests pin the shape it hands back to the
 * balance screen and to the direct-purchase flows that spend from this
 * balance (combined balance, suggested-amount fallback, error surfacing,
 * spend-result pass-through) without re-testing request()'s own auth/retry
 * policy, which api.test.ts already covers.
 */
import { fetchPlatformCreditBalance, postPlatformCreditTopupIntent, postPlatformCreditSpend } from "./api";
import { supabase } from "./supabase";
import {
  loadPlatformCreditState,
  platformCreditSuggestedAmountsKobo,
  startPlatformCreditTopup,
  getServiceProductPriceKobo,
  trySpendPlatformCreditForService,
  spendPlatformCreditOnService,
  hasEnoughPlatformCredit,
} from "./platform-credit";

jest.mock("./api", () => ({
  fetchPlatformCreditBalance: jest.fn(),
  postPlatformCreditTopupIntent: jest.fn(),
  postPlatformCreditSpend: jest.fn(),
}));
jest.mock("./supabase", () => ({ supabase: { from: jest.fn() } }));

const mockFetchBalance = fetchPlatformCreditBalance as jest.MockedFunction<typeof fetchPlatformCreditBalance>;
const mockPostTopupIntent = postPlatformCreditTopupIntent as jest.MockedFunction<typeof postPlatformCreditTopupIntent>;
const mockPostSpend = postPlatformCreditSpend as jest.MockedFunction<typeof postPlatformCreditSpend>;
const mockFrom = supabase.from as unknown as jest.Mock;

/** service_products' own read shape: .select().eq().eq().maybeSingle(). */
function serviceProductTable(result: { data?: { price_kobo: number } | null; error?: { message: string } | null }) {
  const builder: Record<string, unknown> = {
    maybeSingle: () => Promise.resolve(result),
  };
  for (const method of ["select", "eq"]) {
    builder[method] = () => builder;
  }
  return builder;
}

describe("loadPlatformCreditState", () => {
  it("maps a successful response into the balance/ledger shape the screen reads", async () => {
    mockFetchBalance.mockResolvedValue({
      success: true,
      balance_kobo: 500000,
      paid_balance_kobo: 300000,
      promo_balance_kobo: 200000,
      config: { min_topup_kobo: 100000, max_topup_kobo: 500000000, suggested_amounts_kobo: [1000000, 2000000] },
      ledger: [{ id: "l1", entry_type: "topup", amount_kobo: 500000, description: null, created_at: "2026-09-17T00:00:00Z" }],
    });

    await expect(loadPlatformCreditState()).resolves.toEqual({
      ok: true,
      data: {
        balanceKobo: 500000,
        paidBalanceKobo: 300000,
        promoBalanceKobo: 200000,
        config: { min_topup_kobo: 100000, max_topup_kobo: 500000000, suggested_amounts_kobo: [1000000, 2000000] },
        ledger: [{ id: "l1", entry_type: "topup", amount_kobo: 500000, description: null, created_at: "2026-09-17T00:00:00Z" }],
      },
    });
  });

  it("reads a patient who has never topped up as a zero balance, not an error", async () => {
    mockFetchBalance.mockResolvedValue({
      success: true,
      balance_kobo: 0,
      paid_balance_kobo: 0,
      promo_balance_kobo: 0,
      config: null,
      ledger: [],
    });

    await expect(loadPlatformCreditState()).resolves.toEqual({
      ok: true,
      data: { balanceKobo: 0, paidBalanceKobo: 0, promoBalanceKobo: 0, config: null, ledger: [] },
    });
  });

  it("surfaces the server's error rather than throwing", async () => {
    mockFetchBalance.mockResolvedValue({ error: "Invalid or expired session" });
    await expect(loadPlatformCreditState()).resolves.toEqual({
      ok: false,
      error: "Invalid or expired session",
    });
  });
});

describe("platformCreditSuggestedAmountsKobo", () => {
  it("uses the server config when present", () => {
    expect(platformCreditSuggestedAmountsKobo({ min_topup_kobo: 1, max_topup_kobo: 2, suggested_amounts_kobo: [999] })).toEqual([999]);
  });

  it("falls back to the same defaults the web card uses when config hasn't loaded", () => {
    expect(platformCreditSuggestedAmountsKobo(null)).toEqual([1000000, 2000000, 5000000, 10000000]);
  });
});

describe("startPlatformCreditTopup", () => {
  it("returns the checkout URL for the caller to open in the system browser", async () => {
    mockPostTopupIntent.mockResolvedValue({ success: true, checkoutUrl: "https://checkout.paystack.com/abc", intentId: "i1" });
    await expect(startPlatformCreditTopup(1000000)).resolves.toEqual({
      ok: true,
      data: "https://checkout.paystack.com/abc",
    });
    expect(mockPostTopupIntent).toHaveBeenCalledWith(1000000);
  });

  it("surfaces a server-side rejection (e.g. below the configured minimum)", async () => {
    mockPostTopupIntent.mockResolvedValue({ error: "the minimum top-up is 100000 kobo" });
    await expect(startPlatformCreditTopup(500)).resolves.toEqual({
      ok: false,
      error: "the minimum top-up is 100000 kobo",
    });
  });
});

describe("getServiceProductPriceKobo", () => {
  beforeEach(() => mockFrom.mockReset());

  it("returns the product's price", async () => {
    mockFrom.mockReturnValue(serviceProductTable({ data: { price_kobo: 250000 } }));
    await expect(getServiceProductPriceKobo("confidential_message_credit")).resolves.toEqual({
      ok: true,
      data: 250000,
    });
    expect(mockFrom).toHaveBeenCalledWith("service_products");
  });

  it("returns null (not an error) when the product doesn't exist or isn't active", async () => {
    mockFrom.mockReturnValue(serviceProductTable({ data: null }));
    await expect(getServiceProductPriceKobo("not_a_real_code")).resolves.toEqual({ ok: true, data: null });
  });

  it("surfaces a query error rather than throwing", async () => {
    mockFrom.mockReturnValue(serviceProductTable({ error: { message: "network error" } }));
    await expect(getServiceProductPriceKobo("second_opinion_credit")).resolves.toEqual({
      ok: false,
      error: "network error",
    });
  });
});

describe("trySpendPlatformCreditForService", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockPostSpend.mockReset();
  });

  it("spends and reports success when the balance already covers the price", async () => {
    mockFrom.mockReturnValue(serviceProductTable({ data: { price_kobo: 250000 } }));
    mockFetchBalance.mockResolvedValue({
      success: true,
      balance_kobo: 300000,
      paid_balance_kobo: 300000,
      promo_balance_kobo: 0,
      config: null,
      ledger: [],
    });
    mockPostSpend.mockResolvedValue({
      success: true,
      ok: true,
      service_purchase_id: "sp1",
      amount_kobo: 250000,
      new_balance_kobo: 50000,
    });

    await expect(trySpendPlatformCreditForService("confidential_message_credit", "patient-1")).resolves.toEqual({
      spent: true,
    });
    expect(mockPostSpend).toHaveBeenCalledWith("confidential_message_credit", { patientId: "patient-1" });
  });

  it("reports a shortfall without ever calling the spend endpoint when the balance is short", async () => {
    mockFrom.mockReturnValue(serviceProductTable({ data: { price_kobo: 250000 } }));
    mockFetchBalance.mockResolvedValue({
      success: true,
      balance_kobo: 100000,
      paid_balance_kobo: 100000,
      promo_balance_kobo: 0,
      config: null,
      ledger: [],
    });

    await expect(trySpendPlatformCreditForService("confidential_message_credit")).resolves.toEqual({
      spent: false,
      shortfallKobo: 150000,
    });
    expect(mockPostSpend).not.toHaveBeenCalled();
  });

  it("reports the RPC's own shortfall if a concurrent spend wins the race after the client-side check passed", async () => {
    mockFrom.mockReturnValue(serviceProductTable({ data: { price_kobo: 250000 } }));
    mockFetchBalance.mockResolvedValue({
      success: true,
      balance_kobo: 300000,
      paid_balance_kobo: 300000,
      promo_balance_kobo: 0,
      config: null,
      ledger: [],
    });
    mockPostSpend.mockResolvedValue({
      success: true,
      ok: false,
      reason: "insufficient_balance",
      balance_kobo: 0,
      required_kobo: 250000,
      shortfall_kobo: 250000,
    });

    await expect(trySpendPlatformCreditForService("confidential_message_credit")).resolves.toEqual({
      spent: false,
      shortfallKobo: 250000,
    });
  });

  it("reports an error when the product isn't available to buy", async () => {
    mockFrom.mockReturnValue(serviceProductTable({ data: null }));
    await expect(trySpendPlatformCreditForService("not_a_real_code")).resolves.toEqual({
      spent: false,
      error: "This isn't available to buy right now.",
    });
    expect(mockFetchBalance).not.toHaveBeenCalled();
  });

  it("reports an error when the balance can't be loaded", async () => {
    mockFrom.mockReturnValue(serviceProductTable({ data: { price_kobo: 250000 } }));
    mockFetchBalance.mockResolvedValue({ error: "Invalid or expired session" });

    await expect(trySpendPlatformCreditForService("confidential_message_credit")).resolves.toEqual({
      spent: false,
      error: "Invalid or expired session",
    });
  });

  it("reports an error when the purchase is no longer payable", async () => {
    mockFrom.mockReturnValue(serviceProductTable({ data: { price_kobo: 250000 } }));
    mockFetchBalance.mockResolvedValue({
      success: true,
      balance_kobo: 300000,
      paid_balance_kobo: 300000,
      promo_balance_kobo: 0,
      config: null,
      ledger: [],
    });
    mockPostSpend.mockResolvedValue({ success: true, ok: false, reason: "not_payable", status: "active" });

    await expect(trySpendPlatformCreditForService("confidential_message_credit")).resolves.toEqual({
      spent: false,
      error: "This can no longer be paid for — try again.",
    });
  });

  it("surfaces a request-level spend error rather than throwing", async () => {
    mockFrom.mockReturnValue(serviceProductTable({ data: { price_kobo: 250000 } }));
    mockFetchBalance.mockResolvedValue({
      success: true,
      balance_kobo: 300000,
      paid_balance_kobo: 300000,
      promo_balance_kobo: 0,
      config: null,
      ledger: [],
    });
    mockPostSpend.mockResolvedValue({ error: "Couldn't reach the server. Check your connection and try again." });

    await expect(trySpendPlatformCreditForService("confidential_message_credit")).resolves.toEqual({
      spent: false,
      error: "Couldn't reach the server. Check your connection and try again.",
    });
  });
});

describe("spendPlatformCreditOnService", () => {
  it("passes through a successful settlement result", async () => {
    mockPostSpend.mockResolvedValue({
      success: true,
      ok: true,
      service_purchase_id: "sp1",
      amount_kobo: 500000,
      new_balance_kobo: 0,
    });
    await expect(spendPlatformCreditOnService("essential_pack")).resolves.toEqual({
      ok: true,
      data: { ok: true, service_purchase_id: "sp1", amount_kobo: 500000, new_balance_kobo: 0 },
    });
    expect(mockPostSpend).toHaveBeenCalledWith("essential_pack");
  });

  it("passes through an insufficient-balance result rather than treating it as a transport error", async () => {
    mockPostSpend.mockResolvedValue({
      success: true,
      ok: false,
      reason: "insufficient_balance",
      balance_kobo: 100,
      required_kobo: 500000,
      shortfall_kobo: 499900,
    });
    await expect(spendPlatformCreditOnService("essential_pack")).resolves.toEqual({
      ok: true,
      data: { ok: false, reason: "insufficient_balance", balance_kobo: 100, required_kobo: 500000, shortfall_kobo: 499900 },
    });
  });

  it("surfaces a transport/auth error as its own failure, distinct from a within-result rejection", async () => {
    mockPostSpend.mockResolvedValue({ error: "Invalid or expired session" });
    await expect(spendPlatformCreditOnService("essential_pack")).resolves.toEqual({
      ok: false,
      error: "Invalid or expired session",
    });
  });
});

describe("hasEnoughPlatformCredit", () => {
  it("covers a free (zero-price) product regardless of balance", () => {
    expect(hasEnoughPlatformCredit(0, 0)).toBe(true);
  });

  it("covers a price strictly less than the balance", () => {
    expect(hasEnoughPlatformCredit(500000, 300000)).toBe(true);
  });

  it("covers a price exactly equal to the balance", () => {
    expect(hasEnoughPlatformCredit(500000, 500000)).toBe(true);
  });

  it("does not cover a price above the balance", () => {
    expect(hasEnoughPlatformCredit(100, 500000)).toBe(false);
  });
});

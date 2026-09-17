/**
 * platform-credit.ts is a thin domain layer over the api.ts passthrough
 * wrappers (fetchPlatformCreditBalance / postPlatformCreditTopupIntent) —
 * these tests pin the shape it hands back to the balance screen (combined
 * balance, suggested-amount fallback, error surfacing) without re-testing
 * request()'s own auth/retry policy, which api.test.ts already covers.
 */
import { fetchPlatformCreditBalance, postPlatformCreditTopupIntent } from "./api";
import {
  loadPlatformCreditState,
  platformCreditSuggestedAmountsKobo,
  startPlatformCreditTopup,
} from "./platform-credit";

jest.mock("./api", () => ({
  fetchPlatformCreditBalance: jest.fn(),
  postPlatformCreditTopupIntent: jest.fn(),
}));

const mockFetchBalance = fetchPlatformCreditBalance as jest.MockedFunction<typeof fetchPlatformCreditBalance>;
const mockPostTopupIntent = postPlatformCreditTopupIntent as jest.MockedFunction<typeof postPlatformCreditTopupIntent>;

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

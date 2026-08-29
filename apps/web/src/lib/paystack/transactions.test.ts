import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { initializeBankTransferCharge } from "./transactions";
import type { CheckoutMetadata } from "@/lib/billing/checkout-metadata";

/**
 * Only initializeBankTransferCharge() is covered here — it's a pure
 * fetch-in/parsed-result-out function, the same shape as the wearable
 * adapters' follow-up fetches (see
 * apps/web/src/lib/wearables/providers/adapters.test.ts). The booking-level
 * wrapper (initiateBookingTransferCharge(), lib/billing/booking-checkout.ts)
 * also writes to Supabase via the service-role client — untested here for
 * the same reason its sibling initiateBookingCheckout() has no test today:
 * this repo's jest.config.mjs draws the line at "pure lib/validation
 * logic," Server Actions/DB writes are exercised via the running app.
 */

const realFetch = global.fetch;
const realSecretKey = process.env.PAYSTACK_SECRET_KEY;

beforeEach(() => {
  process.env.PAYSTACK_SECRET_KEY = "sk_test_fixture";
});

afterEach(() => {
  global.fetch = realFetch;
  process.env.PAYSTACK_SECRET_KEY = realSecretKey;
});

function stubFetch(envelope: unknown) {
  const fetchMock = jest.fn<
    (url: string, init?: { body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>
  >(async () => ({
    ok: true,
    status: 200,
    json: async () => envelope,
  }));
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const metadata: CheckoutMetadata = {
  kind: "booking",
  profile_id: "patient-1",
  item_code: "lab",
  booking_order_id: "order-1",
  booking_order_type: "lab",
};

describe("initializeBankTransferCharge", () => {
  it("requests the bank_transfer channel in NGN and returns the account details", async () => {
    const fetchMock = stubFetch({
      status: true,
      message: "ok",
      data: {
        reference: "tx_ref_123",
        status: "pay_offline",
        bank_transfer: {
          bank: { name: "Wema/Paystack-Titan" },
          account_number: "7543491975",
          account_expires_at: "2026-08-29T12:30:00.000Z",
        },
      },
    });

    const result = await initializeBankTransferCharge({
      email: "patient@example.com",
      amountMinor: 2_950_000,
      expiresInMinutes: 30,
      metadata,
    });

    expect(result).toEqual({
      ok: true,
      data: {
        reference: "tx_ref_123",
        bankName: "Wema/Paystack-Titan",
        accountNumber: "7543491975",
        expiresAt: "2026-08-29T12:30:00.000Z",
      },
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body ?? "{}");
    expect(body.currency).toBe("NGN");
    expect(body.amount).toBe(2_950_000);
    expect(body.bank_transfer.account_expires_at).toEqual(expect.any(String));
    expect(body.metadata).toEqual(metadata);
  });

  it("falls back to the locally computed expiry if Paystack omits account_expires_at", async () => {
    stubFetch({
      status: true,
      message: "ok",
      data: {
        reference: "tx_ref_456",
        status: "pay_offline",
        bank_transfer: { bank: { name: "Wema/Paystack-Titan" }, account_number: "1111111111" },
      },
    });

    const result = await initializeBankTransferCharge({
      email: "patient@example.com",
      amountMinor: 100_000,
      expiresInMinutes: 30,
      metadata,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(new Date(result.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it("returns a clear error when Paystack succeeds but omits transfer account details", async () => {
    // The shape this account would return if Pay with Transfer isn't
    // enabled yet — success status, but no bank_transfer object at all.
    stubFetch({
      status: true,
      message: "ok",
      data: { reference: "tx_ref_789", status: "pay_offline" },
    });

    const result = await initializeBankTransferCharge({
      email: "patient@example.com",
      amountMinor: 100_000,
      expiresInMinutes: 30,
      metadata,
    });

    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("Pay with Transfer may not be enabled"),
    });
  });

  it("propagates a Paystack-reported error", async () => {
    stubFetch({ status: false, message: "Invalid amount" });

    const result = await initializeBankTransferCharge({
      email: "patient@example.com",
      amountMinor: 0,
      expiresInMinutes: 30,
      metadata,
    });

    expect(result).toEqual({ ok: false, error: "Invalid amount" });
  });

  it("fails without ever calling fetch if PAYSTACK_SECRET_KEY isn't configured", async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await initializeBankTransferCharge({
      email: "patient@example.com",
      amountMinor: 100_000,
      expiresInMinutes: 30,
      metadata,
    });

    expect(result).toEqual({ ok: false, error: "PAYSTACK_SECRET_KEY is not configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

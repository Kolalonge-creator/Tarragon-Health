/**
 * Coverage for the pharmacy-order read/pay data layer behind
 * pharmacy-orders-section.tsx — mirrors emergency.test.ts's pattern of a
 * minimal chainable `supabase.from`/`.rpc` stub, since these functions need
 * a real session to exercise the RLS/RPC side for real (that's covered by
 * schema/RLS review against the live project instead, same reasoning
 * medications.test.ts's header comment gives for its own supabase-calling
 * functions).
 */
import { supabase } from "./supabase";
import {
  getPharmacyOrders,
  isPharmacyOrderPayable,
  payPharmacyOrderWithCredit,
  pharmacyOrderItemsSummary,
  PHARMACY_ORDER_STATUS_LABEL,
  type PharmacyOrderItem,
} from "./prescription-renewal";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

const mockFrom = supabase.from as unknown as jest.Mock;
const mockRpc = supabase.rpc as unknown as jest.Mock;

function ordersTable(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data, error }).then(resolve),
  };
  for (const method of ["select", "eq", "order"]) {
    builder[method] = () => builder;
  }
  return builder;
}

describe("getPharmacyOrders", () => {
  const item: PharmacyOrderItem = {
    medication_id: "med-1",
    drug_name: "Amlodipine 5mg",
    pack_size: "28 tablets",
    price_kobo: 150000,
    quantity: 1,
  };

  it("maps a row into the list shape the screen reads, newest first", async () => {
    mockFrom.mockReturnValue(
      ordersTable([
        {
          id: "order-1",
          order_number: "PH-001",
          status: "pending_payment",
          items: [item],
          total_kobo: 150000,
          payable_kobo: 100000,
          requested_at: "2026-09-17T00:00:00Z",
          fulfilment_method: "pickup",
        },
      ])
    );

    await expect(getPharmacyOrders("patient-1")).resolves.toEqual({
      ok: true,
      data: [
        {
          id: "order-1",
          orderNumber: "PH-001",
          status: "pending_payment",
          items: [item],
          totalKobo: 150000,
          payableKobo: 100000,
          requestedAt: "2026-09-17T00:00:00Z",
          fulfilmentMethod: "pickup",
        },
      ],
    });
  });

  it("falls back payableKobo to totalKobo when the generated column is null", async () => {
    mockFrom.mockReturnValue(
      ordersTable([
        {
          id: "order-2",
          order_number: null,
          status: "payment_confirmed",
          items: [item],
          total_kobo: 150000,
          payable_kobo: null,
          requested_at: "2026-09-16T00:00:00Z",
          fulfilment_method: "delivery",
        },
      ])
    );

    const result = await getPharmacyOrders("patient-1");
    expect(result.ok).toBe(true);
    expect(result.ok && result.data[0].payableKobo).toBe(150000);
  });

  it("copes with a null items column rather than crashing", async () => {
    mockFrom.mockReturnValue(
      ordersTable([
        {
          id: "order-3",
          order_number: null,
          status: "cancelled",
          items: null,
          total_kobo: 0,
          payable_kobo: 0,
          requested_at: "2026-09-15T00:00:00Z",
          fulfilment_method: "pickup",
        },
      ])
    );

    const result = await getPharmacyOrders("patient-1");
    expect(result.ok).toBe(true);
    expect(result.ok && result.data[0].items).toEqual([]);
  });

  it("surfaces a query error rather than throwing", async () => {
    mockFrom.mockReturnValue(ordersTable(null, { message: "RLS denied" }));
    await expect(getPharmacyOrders("patient-1")).resolves.toEqual({ ok: false, error: "RLS denied" });
  });
});

describe("payPharmacyOrderWithCredit", () => {
  it("calls the RPC with the order id and returns its result", async () => {
    mockRpc.mockResolvedValue({
      data: { ok: true, pharmacy_order_id: "order-1", amount_kobo: 100000, new_balance_kobo: 400000 },
      error: null,
    });

    await expect(payPharmacyOrderWithCredit("order-1")).resolves.toEqual({
      ok: true,
      data: { ok: true, pharmacy_order_id: "order-1", amount_kobo: 100000, new_balance_kobo: 400000 },
    });
    expect(mockRpc).toHaveBeenCalledWith("pay_pharmacy_order_on_platform_credit", {
      p_pharmacy_order_id: "order-1",
    });
  });

  it("passes through a business rejection (insufficient balance) as data, not an error", async () => {
    mockRpc.mockResolvedValue({
      data: { ok: false, reason: "insufficient_balance", balance_kobo: 10000, required_kobo: 100000, shortfall_kobo: 90000 },
      error: null,
    });

    const result = await payPharmacyOrderWithCredit("order-1");
    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toEqual({
      ok: false,
      reason: "insufficient_balance",
      balance_kobo: 10000,
      required_kobo: 100000,
      shortfall_kobo: 90000,
    });
  });

  it("surfaces an RPC-level error (network/RLS) as a technical failure", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "not authorised to pay for this order" } });
    await expect(payPharmacyOrderWithCredit("order-1")).resolves.toEqual({
      ok: false,
      error: "not authorised to pay for this order",
    });
  });
});

describe("pharmacyOrderItemsSummary", () => {
  it("joins drug name × quantity across items", () => {
    expect(
      pharmacyOrderItemsSummary([
        { medication_id: "m1", drug_name: "Amlodipine 5mg", pack_size: null, price_kobo: 150000, quantity: 1 },
        { medication_id: "m2", drug_name: "Metformin 500mg", pack_size: null, price_kobo: 100000, quantity: 2 },
      ])
    ).toBe("Amlodipine 5mg × 1, Metformin 500mg × 2");
  });

  it("returns an empty string for no items", () => {
    expect(pharmacyOrderItemsSummary([])).toBe("");
  });
});

describe("isPharmacyOrderPayable", () => {
  it("is payable only at pending_payment", () => {
    expect(isPharmacyOrderPayable("pending_payment")).toBe(true);
    for (const status of Object.keys(PHARMACY_ORDER_STATUS_LABEL)) {
      if (status === "pending_payment") continue;
      expect(isPharmacyOrderPayable(status as never)).toBe(false);
    }
  });
});

describe("PHARMACY_ORDER_STATUS_LABEL", () => {
  it("has a label for every status the DB enum can hold", () => {
    const expectedStatuses = [
      "pending_payment",
      "payment_confirmed",
      "requested",
      "confirmed",
      "unavailable",
      "dispensed",
      "out_for_delivery",
      "delivery_failed",
      "delivered",
      "cancelled",
    ];
    expect(Object.keys(PHARMACY_ORDER_STATUS_LABEL).sort()).toEqual(expectedStatuses.sort());
  });
});

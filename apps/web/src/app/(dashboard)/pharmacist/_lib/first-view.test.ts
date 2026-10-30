import type { PharmacistProfile } from "@/lib/queries/pharmacist";
import type { QuerySlice } from "@/lib/queries/query-slice";
import type { PharmacistOrderRow } from "./items";
import { buildPharmacistOverview, type PharmacistOverviewInputs } from "./overview-summary";
import { pharmacistFirstView } from "./first-view";

const NOW = new Date("2026-10-30T10:00:00.000Z");

const order = (status: string, id = status): PharmacistOrderRow => ({
  order_id: id,
  order_number: null,
  status,
  patient_name: "Test Patient",
  patient_number: null,
  items: [],
  requested_at: "2026-10-30T08:00:00.000Z",
  payable_kobo: null,
  confirmed_quantity: null,
  confirmed_price_kobo: null,
  estimated_fulfilment_at: null,
  cancellation_reason: null,
});

const profile = (expires: string): PharmacistProfile => ({
  name: "Test Pharmacy",
  regions: ["Lagos"],
  city: null,
  state: null,
  contact_phone: null,
  contact_email: null,
  license_number: "PCN-123",
  license_expires_at: expires,
});

const loaded = <T,>(data: T): QuerySlice<T> => ({ data, isLoading: false, isError: false });
const loading = <T,>(): QuerySlice<T> => ({ data: undefined, isLoading: true, isError: false });
const failed = <T,>(): QuerySlice<T> => ({ data: undefined, isLoading: false, isError: true });
const stale = <T,>(data: T): QuerySlice<T> => ({ data, isLoading: false, isError: true });

function first(o: Partial<PharmacistOverviewInputs> = {}) {
  return pharmacistFirstView(
    buildPharmacistOverview(
      {
        orders: loaded([]),
        dispenses: loaded([]),
        profile: loaded(profile("2027-06-30")),
        ...o,
      },
      NOW
    )
  );
}

describe("pharmacistFirstView", () => {
  it("leads with an expired licence, then orders, then nothing else", () => {
    const v = first({ orders: loaded([order("payment_confirmed")]), profile: loaded(profile("2026-01-01")) });
    if (v.kind !== "items") throw new Error("expected items");
    expect(v.top.key).toBe("licence-expired");
    expect(v.rest.map((i) => i.key)).toEqual(["orders"]);
    expect(v.caveat).toBe("none");
  });

  it("counts only paid orders awaiting a response, not unpaid ones or in-progress ones", () => {
    const v = first({
      orders: loaded([order("pending_payment", "a"), order("confirmed", "b"), order("payment_confirmed", "c")]),
    });
    if (v.kind !== "items") throw new Error("expected items");
    expect(v.top.text).toBe("1 order is waiting for you");
  });

  it("puts a soon-to-expire licence after the orders", () => {
    const v = first({ orders: loaded([order("requested", "a"), order("requested", "b")]), profile: loaded(profile("2026-12-01")) });
    if (v.kind !== "items") throw new Error("expected items");
    expect(v.top.text).toBe("2 orders are waiting for you");
    expect(v.rest.map((i) => i.key)).toEqual(["licence-soon"]);
  });

  it("is clear only when orders and profile were both read, current, and nothing is wrong", () => {
    expect(first()).toEqual({ kind: "clear" });
  });

  it("never says clear when the orders read failed", () => {
    expect(first({ orders: failed() })).toEqual({ kind: "unknown" });
  });

  it("never says clear when the profile read failed", () => {
    expect(first({ profile: failed() })).toEqual({ kind: "unknown" });
  });

  it("marks a list incomplete when something showed but another read failed", () => {
    const v = first({ orders: loaded([order("payment_confirmed")]), profile: failed() });
    expect(v).toMatchObject({ kind: "items", caveat: "incomplete" });
  });

  it("a stale all-clear is stale, not clear", () => {
    expect(first({ orders: stale([]) })).toEqual({ kind: "stale" });
  });

  it("flags a list built from stale data", () => {
    const v = first({ orders: stale([order("payment_confirmed")]) });
    expect(v).toMatchObject({ kind: "items", caveat: "stale" });
  });

  it("waits while orders are only loading, and a failure outranks loading", () => {
    expect(first({ orders: loading() })).toEqual({ kind: "loading" });
    expect(first({ orders: loading(), profile: failed() })).toEqual({ kind: "unknown" });
  });
});

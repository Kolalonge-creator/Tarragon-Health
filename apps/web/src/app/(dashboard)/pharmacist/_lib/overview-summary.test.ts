import type { PharmacistDispense, PharmacistProfile } from "@/lib/queries/pharmacist";
import type { QuerySlice } from "@/lib/queries/query-slice";
import type { PharmacistOrderRow } from "./items";
import { buildPharmacistOverview, licenceTone, type PharmacistOverviewInputs } from "./overview-summary";

const NOW = new Date("2026-10-30T10:00:00.000Z");
const TODAY = "2026-10-30";

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

const dispense = (on: string, id: string): PharmacistDispense => ({
  dispense_id: id,
  patient_name: "Test Patient",
  drug_name: "Medicine",
  quantity: "10",
  dispensed_on: on,
});

const PROFILE: PharmacistProfile = {
  name: "Test Pharmacy",
  regions: ["Lagos", "Ogun"],
  city: null,
  state: null,
  contact_phone: null,
  contact_email: null,
  license_number: "PCN-123",
  license_expires_at: "2027-06-30",
};

const loaded = <T,>(data: T): QuerySlice<T> => ({ data, isLoading: false, isError: false });
const loading = <T,>(): QuerySlice<T> => ({ data: undefined, isLoading: true, isError: false });
const failed = <T,>(): QuerySlice<T> => ({ data: undefined, isLoading: false, isError: true });
const stale = <T,>(data: T): QuerySlice<T> => ({ data, isLoading: false, isError: true });

function inputs(o: Partial<PharmacistOverviewInputs> = {}): PharmacistOverviewInputs {
  return {
    orders: loaded([order("payment_confirmed", "a"), order("confirmed", "b"), order("dispensed", "c")]),
    dispenses: loaded([dispense(TODAY, "d1"), dispense("2026-10-29", "d2")]),
    profile: loaded(PROFILE),
    ...o,
  };
}

describe("buildPharmacistOverview: loaded", () => {
  it("counts awaiting, in progress and open orders from the read", () => {
    const v = buildPharmacistOverview(inputs(), NOW);
    expect(v.orders.tiles.awaiting).toEqual({ value: "1" });
    expect(v.orders.tiles.inProgress).toEqual({ value: "1" });
    expect(v.orders.tiles.open).toEqual({ value: "2" });
    expect(v.orders.caughtUp).toBe(false);
    expect(v.orders.snapshot.map((o) => o.order_id)).toEqual(["a", "b"]);
  });

  it("counts only what was dispensed today in Lagos", () => {
    const v = buildPharmacistOverview(inputs(), NOW);
    expect(v.dispenses.tile).toEqual({ value: "1" });
    expect(v.dispenses.today.map((d) => d.dispense_id)).toEqual(["d1"]);
    expect(v.dispenses.nothingYet).toBe(false);
  });

  it("says caught up only when the orders were read and none are open", () => {
    const v = buildPharmacistOverview(inputs({ orders: loaded([order("dispensed"), order("cancelled")]) }), NOW);
    expect(v.orders.tiles.open).toEqual({ value: "0" });
    expect(v.orders.caughtUp).toBe(true);
  });

  it("says nothing dispensed yet only when the history was read and none is today", () => {
    const v = buildPharmacistOverview(inputs({ dispenses: loaded([dispense("2026-10-29", "x")]) }), NOW);
    expect(v.dispenses.tile).toEqual({ value: "0" });
    expect(v.dispenses.nothingYet).toBe(true);
  });

  it("caps the open-orders snapshot at three", () => {
    const rows = ["a", "b", "c", "d"].map((id) => order("payment_confirmed", id));
    expect(buildPharmacistOverview(inputs({ orders: loaded(rows) }), NOW).orders.snapshot).toHaveLength(3);
  });
});

describe("buildPharmacistOverview: loading", () => {
  it("shows Loading, never 0, and never claims caught up", () => {
    const v = buildPharmacistOverview(
      inputs({ orders: loading(), dispenses: loading(), profile: loading() }),
      NOW
    );
    expect(v.orders.tiles.awaiting).toEqual({ empty: { hint: "Loading…" } });
    expect(v.orders.tiles.open).toEqual({ empty: { hint: "Loading…" } });
    expect(v.dispenses.tile).toEqual({ empty: { hint: "Loading…" } });
    expect(v.orders.caughtUp).toBe(false);
    expect(v.dispenses.nothingYet).toBe(false);
    expect(v.profile.kind).toBe("unknown");
  });
});

describe("buildPharmacistOverview: failed", () => {
  it("shows Could not be loaded, never 0, and never claims caught up", () => {
    const v = buildPharmacistOverview(
      inputs({ orders: failed(), dispenses: failed(), profile: failed() }),
      NOW
    );
    expect(v.orders.state).toBe("failed");
    expect(v.orders.tiles.awaiting).toEqual({ empty: { hint: "Could not be loaded" } });
    expect(v.orders.tiles.inProgress).toEqual({ empty: { hint: "Could not be loaded" } });
    expect(v.dispenses.tile).toEqual({ empty: { hint: "Could not be loaded" } });
    expect(v.orders.caughtUp).toBe(false);
    expect(v.dispenses.nothingYet).toBe(false);
    expect(v.profile.kind).toBe("unknown");
    expect(v.profile.licence).toBe("Could not be loaded");
  });

  it("fails each section on its own", () => {
    const v = buildPharmacistOverview(inputs({ dispenses: failed() }), NOW);
    expect(v.dispenses.state).toBe("failed");
    expect(v.orders.state).toBe("ready");
    expect(v.orders.tiles.awaiting).toEqual({ value: "1" });
  });
});

describe("buildPharmacistOverview: a refresh failed after a good read", () => {
  it("keeps the last good orders, marks them stale, and does not claim caught up", () => {
    const v = buildPharmacistOverview(inputs({ orders: stale([order("payment_confirmed", "a")]) }), NOW);
    expect(v.orders.state).toBe("stale");
    expect(v.orders.tiles.awaiting).toEqual({ value: "1" });
    expect(v.orders.snapshot).toHaveLength(1);
  });

  it("does not claim caught up from a stale empty list", () => {
    const v = buildPharmacistOverview(inputs({ orders: stale([]) }), NOW);
    expect(v.orders.state).toBe("stale");
    expect(v.orders.caughtUp).toBe(false);
  });

  it("does not claim nothing was dispensed from a stale empty history", () => {
    const v = buildPharmacistOverview(inputs({ dispenses: stale([]) }), NOW);
    expect(v.dispenses.nothingYet).toBe(false);
  });
});

describe("profile", () => {
  it("tells no profile on file apart from not read", () => {
    expect(buildPharmacistOverview(inputs({ profile: loaded(null) }), NOW).profile.kind).toBe("none");
    expect(buildPharmacistOverview(inputs({ profile: failed() }), NOW).profile.kind).toBe("unknown");
  });

  it("joins regions and says so when none or no licence is recorded", () => {
    const v = buildPharmacistOverview(inputs(), NOW);
    expect(v.profile.regions).toBe("Lagos, Ogun");
    expect(v.profile.licence).toBe("PCN-123");
    const bare = buildPharmacistOverview(
      inputs({ profile: loaded({ ...PROFILE, regions: [], license_number: null, license_expires_at: null }) }),
      NOW
    );
    expect(bare.profile.regions).toBe("None set");
    expect(bare.profile.licence).toBe("Not recorded");
    expect(bare.profile.expires).toEqual({ text: "Not recorded", tone: "ok", note: null });
  });

  it("marks an expired licence as expired, not just soon", () => {
    const v = buildPharmacistOverview(
      inputs({ profile: loaded({ ...PROFILE, license_expires_at: "2026-01-31" }) }),
      NOW
    );
    expect(v.profile.expires.tone).toBe("expired");
    expect(v.profile.expires.note).toBe("Expired");
  });

  it("marks a licence expiring within 60 days as soon", () => {
    const v = buildPharmacistOverview(
      inputs({ profile: loaded({ ...PROFILE, license_expires_at: "2026-12-15" }) }),
      NOW
    );
    expect(v.profile.expires.tone).toBe("soon");
    expect(v.profile.expires.note).toBe("Expires soon");
  });
});

describe("licenceTone", () => {
  it("treats a missing or unparseable date as ok, not expired", () => {
    expect(licenceTone(null, NOW)).toBe("ok");
    expect(licenceTone("not a date", NOW)).toBe("ok");
  });

  it("separates expired, soon and ok", () => {
    expect(licenceTone("2026-10-29", NOW)).toBe("expired");
    expect(licenceTone("2026-11-30", NOW)).toBe("soon");
    expect(licenceTone("2027-06-30", NOW)).toBe("ok");
  });

  it("treats a date-only expiry as valid through the whole of that Lagos day", () => {
    // 10:00 UTC on the expiry date is 11:00 in Lagos: still the last valid day.
    expect(licenceTone("2026-10-30", NOW)).toBe("soon");
    // 23:30 UTC is 00:30 the next day in Lagos: now expired.
    expect(licenceTone("2026-10-30", new Date("2026-10-30T23:30:00.000Z"))).toBe("expired");
  });

  it("flips from soon to ok at the 60 day edge", () => {
    expect(licenceTone("2026-12-27", NOW)).toBe("soon");
    expect(licenceTone("2026-12-28", NOW)).toBe("ok");
  });
});

describe("expiry text", () => {
  it("shows the calendar date a date-only expiry names", () => {
    const v = buildPharmacistOverview(
      inputs({ profile: loaded({ ...PROFILE, license_expires_at: "2027-06-30" }) }),
      NOW
    );
    expect(v.profile.expires.text).toBe("30 Jun 2027");
  });

  it("says a malformed expiry is not a valid date, never 'Invalid Date'", () => {
    const v = buildPharmacistOverview(
      inputs({ profile: loaded({ ...PROFILE, license_expires_at: "30/10/2026" }) }),
      NOW
    );
    expect(v.profile.expires.text).toBe("Not a valid date");
    expect(v.profile.expires.text).not.toMatch(/Invalid/);
  });
});

import { isAwaitingStatus, isOpenStatus, statusMeta, STATUS_META } from "./order-status";

/**
 * pharmacy_order_status (DB enum) as of writing: pending_payment,
 * payment_confirmed, requested, confirmed, dispensed, out_for_delivery,
 * delivered, cancelled. This list is duplicated here deliberately so the
 * test fails loudly if the enum gains a value STATUS_META hasn't been
 * taught about, rather than the dashboard silently bucketing it as "grey".
 */
const ALL_ENUM_VALUES = [
  "pending_payment",
  "payment_confirmed",
  "requested",
  "confirmed",
  "dispensed",
  "out_for_delivery",
  "delivered",
  "cancelled",
] as const;

describe("STATUS_META", () => {
  it("has an explicit entry for every known pharmacy_order_status value", () => {
    for (const status of ALL_ENUM_VALUES) {
      expect(STATUS_META[status]).toBeDefined();
    }
  });
});

describe("statusMeta", () => {
  it.each([
    ["pending_payment", "Awaiting", "amber"],
    ["payment_confirmed", "Awaiting", "amber"],
    ["requested", "Awaiting", "amber"],
    ["confirmed", "In progress", "blue"],
    ["dispensed", "Dispensed", "green"],
    ["out_for_delivery", "Dispensed", "green"],
    ["delivered", "Dispensed", "green"],
    ["cancelled", "Cancelled", "grey"],
  ])("maps %s to label %s / badge %s", (status, label, badge) => {
    expect(statusMeta(status)).toEqual({ label, badge });
  });

  it("falls back to a grey badge with the raw status as its label for an unmapped value", () => {
    expect(statusMeta("some_future_status")).toEqual({ label: "some_future_status", badge: "grey" });
  });
});

describe("isOpenStatus", () => {
  it("is true for every awaiting/in-progress status", () => {
    expect(isOpenStatus("pending_payment")).toBe(true);
    expect(isOpenStatus("payment_confirmed")).toBe(true);
    expect(isOpenStatus("requested")).toBe(true);
    expect(isOpenStatus("confirmed")).toBe(true);
  });

  it("is false for every terminal status, including cancelled", () => {
    expect(isOpenStatus("dispensed")).toBe(false);
    expect(isOpenStatus("out_for_delivery")).toBe(false);
    expect(isOpenStatus("delivered")).toBe(false);
    expect(isOpenStatus("cancelled")).toBe(false);
  });

  it("defaults an unrecognised status to open, so a new enum value stays visible on the worklist rather than silently vanishing", () => {
    expect(isOpenStatus("some_future_status")).toBe(true);
  });
});

describe("isAwaitingStatus", () => {
  it("is true only for the three pre-dispensing statuses", () => {
    expect(isAwaitingStatus("pending_payment")).toBe(true);
    expect(isAwaitingStatus("payment_confirmed")).toBe(true);
    expect(isAwaitingStatus("requested")).toBe(true);
  });

  it("is false for in-progress and every terminal status", () => {
    expect(isAwaitingStatus("confirmed")).toBe(false);
    expect(isAwaitingStatus("dispensed")).toBe(false);
    expect(isAwaitingStatus("out_for_delivery")).toBe(false);
    expect(isAwaitingStatus("delivered")).toBe(false);
    expect(isAwaitingStatus("cancelled")).toBe(false);
  });

  it("defaults an unrecognised status to not-awaiting", () => {
    expect(isAwaitingStatus("some_future_status")).toBe(false);
  });
});

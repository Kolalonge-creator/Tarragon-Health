import { endpointState, isBusEventType, isIntegrationEventType, parseIdKeys, parseResult } from "./partner-model";

describe("parseIdKeys", () => {
  it("accepts ids and lists, in any separator, once each", () => {
    expect(parseIdKeys("lab_order_id, result_ids\nlab_order_id")).toEqual({ ok: true, keys: ["lab_order_id", "result_ids"] });
  });
  it("allows none (the event is sent with no ids)", () => {
    expect(parseIdKeys("")).toEqual({ ok: true, keys: [] });
    expect(parseIdKeys(undefined)).toEqual({ ok: true, keys: [] });
  });
  it("refuses a key that names a person, whatever else is listed", () => {
    expect(parseIdKeys("lab_order_id, patient_id")).toEqual({ ok: false, reason: "person" });
    expect(parseIdKeys("user_id")).toEqual({ ok: false, reason: "person" });
    // keys that can carry a person indirectly are refused on this screen too
    for (const k of ["aggregate_id", "subject_id", "recipient_id", "owner_id"]) expect(parseIdKeys(k)).toEqual({ ok: false, reason: "person" });
  });
  it("refuses anything that is not an id key, and more than twenty", () => {
    expect(parseIdKeys("systolic")).toEqual({ ok: false, reason: "format" });
    expect(parseIdKeys("Lab_Order_ID")).toEqual({ ok: false, reason: "format" });
    expect(parseIdKeys(Array.from({ length: 21 }, (_, i) => `k${i}_id`).join(" "))).toEqual({ ok: false, reason: "too_many" });
  });
});

describe("shape checks", () => {
  it("knows the bus and partner event names", () => {
    expect(isBusEventType("observation.recorded")).toBe(true);
    expect(isBusEventType("Observation Recorded")).toBe(false);
    expect(isBusEventType("x'; drop table")).toBe(false);
    expect(isIntegrationEventType("result.available")).toBe(true);
    expect(isIntegrationEventType("result.invented")).toBe(false);
  });
  it("offers re-enable only for an endpoint the platform switched off", () => {
    expect(endpointState({ is_active: true, auto_disabled_at: null })).toBe("active");
    expect(endpointState({ is_active: false, auto_disabled_at: "2026-10-19T00:00:00Z" })).toBe("auto_disabled");
    expect(endpointState({ is_active: false, auto_disabled_at: null })).toBe("off");
  });
  it("only lets a fixed set of words travel in the address", () => {
    expect(parseResult("rotated")).toBe("rotated");
    expect(parseResult("<script>")).toBeNull();
  });
});

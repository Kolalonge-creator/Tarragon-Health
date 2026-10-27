import { describe, expect, it } from "@jest/globals";
import { assistedRefusalResponse } from "./assisted-refusal";

describe("assistedRefusalResponse", () => {
  it("maps each guard refusal to a status the phone's queue understands and plain words", () => {
    const cases: Array<[string, number]> = [
      ["assisted_entry_not_permitted: you have not been allowed", 403],
      ["assisted_entry_rate_limited: too many readings", 429],
      ["assisted_entry_source: a reading entered", 422],
      ["assisted_entry_time: that reading is too old", 422],
      ["assisted_entry_unavailable: not available", 503],
    ];
    for (const [message, status] of cases) {
      const r = assistedRefusalResponse({ code: "x", message });
      expect(r?.status).toBe(status);
      expect(r?.message).not.toMatch(/assisted_entry|53400|42501/);
    }
  });
  it("leaves any other database error alone so the caller keeps its own handling", () => {
    expect(assistedRefusalResponse({ code: "23505", message: "duplicate key value" })).toBeNull();
    expect(assistedRefusalResponse(null)).toBeNull();
    expect(assistedRefusalResponse(undefined)).toBeNull();
  });
});

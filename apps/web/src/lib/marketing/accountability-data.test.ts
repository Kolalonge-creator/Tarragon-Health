import { TIER_COPY, humaniseMinutes } from "./accountability-data";

describe("humaniseMinutes", () => {
  it("keeps sub-hour commitments in minutes", () => {
    expect(humaniseMinutes(15)).toBe("15 minutes");
    expect(humaniseMinutes(59)).toBe("59 minutes");
  });

  it("reads an hour singular and the rest plural", () => {
    expect(humaniseMinutes(60)).toBe("1 hour");
    expect(humaniseMinutes(120)).toBe("2 hours");
    expect(humaniseMinutes(240)).toBe("4 hours");
  });

  it("states a one-day commitment as 24 hours, never as 1 day", () => {
    // The live urgent_escalation ceiling. "within 1 day" reads as loose and
    // tomorrow-ish; "within 24 hours" is how the same promise is actually kept.
    expect(humaniseMinutes(1440)).toBe("24 hours");
    expect(humaniseMinutes(2880)).toBe("48 hours");
  });

  it("switches to days only past two", () => {
    expect(humaniseMinutes(4320)).toBe("3 days");
    expect(humaniseMinutes(10080)).toBe("7 days");
  });

  it("covers every tier the published RPC can return", () => {
    // 'routine' is excluded by the RPC itself, so these three are the full set.
    expect(Object.keys(TIER_COPY).sort()).toEqual([
      "clinician_review",
      "emergency",
      "urgent_escalation",
    ]);
    for (const copy of Object.values(TIER_COPY)) {
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.meaning.length).toBeGreaterThan(0);
    }
  });
});

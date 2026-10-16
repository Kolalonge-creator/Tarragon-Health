import { describe, expect, it } from "@jest/globals";
import { assistedEntryCaption, assistedEntryLabel, assistedRefusalMessage, classifyAssistedRefusal, parseAssistedAttribution } from "./assisted-entry";

describe("assisted entry words", () => {
  it("says who entered it from each point of view and never claims the person typed it", () => {
    expect(assistedEntryLabel("Tunde", "patient")).toBe("Entered for you by Tunde");
    expect(assistedEntryLabel(null, "patient")).toBe("Entered for you by someone who helps you");
    expect(assistedEntryLabel("Tunde", "clinician")).toBe("Entered on the patient's behalf by Tunde");
    expect(assistedEntryLabel("Tunde", "helper")).toBe("Entered by you for them");
    expect(assistedEntryLabel("Ada Pharmacy", "patient", "pharmacy")).toContain("at the pharmacy");
    for (const a of ["patient", "clinician", "helper"] as const) expect(assistedEntryLabel("Tunde", a)).not.toMatch(/Typed by you/);
  });
  it("trims and caps a name and treats a blank name as unknown", () => {
    expect(assistedEntryLabel("   ", "patient")).toBe("Entered for you by someone who helps you");
    expect(assistedEntryLabel("x".repeat(200), "patient").length).toBeLessThan(100);
  });
  it("captions a chart only when some points were helper-entered", () => {
    expect(assistedEntryCaption(0, 10)).toBeNull();
    expect(assistedEntryCaption(2, 0)).toBeNull();
    expect(assistedEntryCaption(1, 10)).toBe("1 of 10 readings here was entered by a helper on the person's behalf.");
    expect(assistedEntryCaption(3, 10)).toContain("3 of 10 readings here were entered");
    expect(assistedEntryCaption(99, 10)).toContain("10 of 10");
  });
  it("parses the attribution answer and drops malformed rows", () => {
    expect(parseAssistedAttribution([{ reading_id: "r1", actor_id: "a1", actor_name: "Tunde", actor_kind: "caregiver" }, { reading_id: 5 }, null, "x"])).toEqual([
      { readingId: "r1", actorId: "a1", actorName: "Tunde", actorKind: "caregiver" },
    ]);
    expect(parseAssistedAttribution({ not: "an array" })).toEqual([]);
    expect(parseAssistedAttribution(undefined)).toEqual([]);
  });
  it("recognises each refusal by its marker and gives plain words without the database text", () => {
    const cases: Array<[string, ReturnType<typeof classifyAssistedRefusal>]> = [
      ["assisted_entry_rate_limited: too many", "rate_limited"],
      ["assisted_entry_not_permitted: you have not", "not_permitted"],
      ["assisted_entry_source: x", "source"],
      ["assisted_entry_time: x", "too_old"],
      ["assisted_entry_unavailable: x", "unavailable"],
      ["permission denied for table", null],
    ];
    for (const [message, expected] of cases) expect(classifyAssistedRefusal({ message })).toBe(expected);
    expect(classifyAssistedRefusal(null)).toBeNull();
    for (const k of ["rate_limited", "not_permitted", "source", "too_old", "unavailable"] as const) {
      const m = assistedRefusalMessage(k);
      expect(m).not.toMatch(/assisted_entry|42501|53400/);
      expect(m).not.toContain("—");
    }
  });
});

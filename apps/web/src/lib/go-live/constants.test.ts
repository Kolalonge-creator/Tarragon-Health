import { GUARD_KEYS } from "./constants";

describe("GUARD_KEYS", () => {
  it("lists the research export and symptom checker guards, so set_go_live_guard and the attestations are not refused before the database", () => {
    expect(GUARD_KEYS as readonly string[]).toEqual(expect.arrayContaining(["research_export_enabled", "symptom_checker_enabled"]));
  });

  it("has no duplicates", () => {
    expect(new Set(GUARD_KEYS).size).toBe(GUARD_KEYS.length);
  });
});

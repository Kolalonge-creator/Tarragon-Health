import {
  isSpecificEnough,
  toSearchTerm,
} from "@/app/(marketing)/_components/eligibility-search-term";

/**
 * The regression these guard: `%%` typed into the unauthenticated eligibility
 * checker used to be interpolated straight into an `ilike("name", "%...%")`
 * filter, matching every active partner organisation, and the action then
 * echoed the first match's real name back. Two keystrokes, no account, a
 * partner directory.
 */
describe("toSearchTerm", () => {
  it("strips every character PostgREST would read as a LIKE operator", () => {
    expect(toSearchTerm("%%")).toBe("");
    expect(toSearchTerm("%")).toBe("");
    expect(toSearchTerm("_")).toBe("");
    expect(toSearchTerm("*")).toBe("");
    expect(toSearchTerm("\\")).toBe("");
    expect(toSearchTerm("%_*\\")).toBe("");
  });

  it("leaves a real company name intact", () => {
    expect(toSearchTerm("  Reliance HMO ")).toBe("Reliance HMO");
    expect(toSearchTerm("Guaranty Trust")).toBe("Guaranty Trust");
  });

  it("does not let a wildcard survive by hiding inside a plausible name", () => {
    expect(toSearchTerm("a%b")).toBe("ab");
    expect(toSearchTerm("Rel*ance")).toBe("Relance");
  });
});

describe("isSpecificEnough", () => {
  it("rejects a term that only trawls the table", () => {
    // What the sanitised forms of the old bypasses reduce to.
    expect(isSpecificEnough(toSearchTerm("%%"))).toBe(false);
    expect(isSpecificEnough(toSearchTerm("%a%"))).toBe(false);
    expect(isSpecificEnough(toSearchTerm("ab"))).toBe(false);
    // Long enough, but carries almost no letters to match on.
    expect(isSpecificEnough("1234")).toBe(false);
    expect(isSpecificEnough("a123")).toBe(false);
  });

  it("accepts a name someone would actually type", () => {
    expect(isSpecificEnough(toSearchTerm("Avon"))).toBe(true);
    expect(isSpecificEnough(toSearchTerm("Reliance HMO"))).toBe(true);
  });
});

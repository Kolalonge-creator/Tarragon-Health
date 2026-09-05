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
    expect(isSpecificEnough(toSearchTerm("*"))).toBe(false);
    // Long enough, but carries no letters to match on.
    expect(isSpecificEnough("1234")).toBe(false);
    expect(isSpecificEnough("a123")).toBe(false);
  });

  it("accepts a real short employer or HMO name", () => {
    // Three-letter names are the point: a four-character floor made GTB, UBA
    // and AXA uncheckable, and the checker filed them as leads instead of
    // answering the question they asked.
    expect(isSpecificEnough(toSearchTerm("GTB"))).toBe(true);
    expect(isSpecificEnough(toSearchTerm("UBA"))).toBe(true);
    expect(isSpecificEnough(toSearchTerm("AXA"))).toBe(true);
  });

  it("still strips the wildcards out of a short name before judging it", () => {
    // "GT%" is three characters raw and two after sanitising: accepted as the
    // literal term "GT", never as a pattern.
    expect(toSearchTerm("GT%")).toBe("GT");
    expect(isSpecificEnough(toSearchTerm("GT%"))).toBe(true);
    // ...whereas a name made ENTIRELY of wildcards has nothing left.
    expect(isSpecificEnough(toSearchTerm("%%%"))).toBe(false);
  });

  it("accepts a name someone would actually type", () => {
    expect(isSpecificEnough(toSearchTerm("Avon"))).toBe(true);
    expect(isSpecificEnough(toSearchTerm("Reliance HMO"))).toBe(true);
  });
});

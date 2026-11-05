import { parseReferenceLines, referencesToLines, resourceSaveErrorMessage } from "./marketing-resources";

jest.mock("@/lib/supabase/client", () => ({ createClient: jest.fn() }));

describe("health library editor helpers (website Phase 4)", () => {
  it("reads 'Label | link' lines, keeping only http(s) links", () => {
    expect(
      parseReferenceLines(
        "NICE NG136 | https://www.nice.org.uk/guidance/ng136\nno link here\nBad | javascript:alert(1)\n  \nWHO | http://who.int/x"
      )
    ).toEqual([
      { label: "NICE NG136", url: "https://www.nice.org.uk/guidance/ng136" },
      { label: "WHO", url: "http://who.int/x" },
    ]);
  });

  it("round-trips stored references back to editable lines", () => {
    const stored = [{ label: "NICE NG136", url: "https://www.nice.org.uk/guidance/ng136" }];
    expect(parseReferenceLines(referencesToLines(stored))).toEqual(stored);
  });

  it("explains the database's clinical review refusal in plain words", () => {
    expect(resourceSaveErrorMessage({ code: "23514", message: "clinical_review_required" })).toMatch(/reviewed it/);
    expect(resourceSaveErrorMessage({ message: "duplicate key" })).toBe("duplicate key");
  });
});

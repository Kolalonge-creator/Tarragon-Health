import { describe, expect, it } from "@jest/globals";
import {
  nominateNextOfKinSchema,
  eldercareAccessRequestSchema,
  inverseRelationship,
} from "./care-access";

describe("nominateNextOfKinSchema", () => {
  it("accepts a valid nomination", () => {
    const result = nominateNextOfKinSchema.safeParse({
      full_name: "Ada Obi",
      phone: "+2348012345678",
      relationship: "spouse",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a phone number without international format", () => {
    const result = nominateNextOfKinSchema.safeParse({
      full_name: "Ada Obi",
      phone: "08012345678",
      relationship: "spouse",
    });
    expect(result.success).toBe(false);
  });
});

describe("eldercareAccessRequestSchema", () => {
  it("accepts a valid i_will_manage request", () => {
    const result = eldercareAccessRequestSchema.safeParse({
      phone: "+2348012345678",
      relationship: "child",
      direction: "i_will_manage",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown direction", () => {
    const result = eldercareAccessRequestSchema.safeParse({
      phone: "+2348012345678",
      relationship: "child",
      direction: "i_will_take_over",
    });
    expect(result.success).toBe(false);
  });
});

describe("inverseRelationship", () => {
  it("swaps parent and child", () => {
    expect(inverseRelationship("parent")).toBe("child");
    expect(inverseRelationship("child")).toBe("parent");
  });

  it("swaps grandparent and grandchild", () => {
    expect(inverseRelationship("grandparent")).toBe("grandchild");
    expect(inverseRelationship("grandchild")).toBe("grandparent");
  });

  it("keeps symmetric relationships unchanged", () => {
    expect(inverseRelationship("spouse")).toBe("spouse");
    expect(inverseRelationship("sibling")).toBe("sibling");
    expect(inverseRelationship("other")).toBe("other");
  });

  it("falls back to the input for an unrecognised value", () => {
    expect(inverseRelationship("colleague")).toBe("colleague");
  });

  it("is its own inverse applied twice, for every listed relationship", () => {
    // The bug this guards: createEldercareAccessRequestAction inverts once
    // at write time (i_will_help direction) and care-access-requests-list.tsx
    // inverts once more at read time for the non-owner viewer. Applying the
    // map twice must always return the original word, or a value with no
    // clean inverse (there isn't one in this list) would drift on re-render.
    for (const word of ["parent", "child", "grandparent", "grandchild", "spouse", "sibling", "other"]) {
      expect(inverseRelationship(inverseRelationship(word))).toBe(word);
    }
  });
});

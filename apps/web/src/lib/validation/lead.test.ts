import { describe, expect, it } from "@jest/globals";
import { leadSchema } from "./lead";

describe("leadSchema", () => {
  it("accepts a valid lead submission", () => {
    const result = leadSchema.safeParse({
      name: "Ada Okonkwo",
      contact: "ada@example.com",
      role: "family",
      message: "Interested in ParentCare",
      source: "homepage",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty name", () => {
    const result = leadSchema.safeParse({
      name: " ",
      contact: "+2348012345678",
      role: "patient",
      source: "contact",
    });
    expect(result.success).toBe(false);
  });
});

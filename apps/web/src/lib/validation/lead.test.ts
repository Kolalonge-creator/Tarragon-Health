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

  it("accepts a lead with no goal selected", () => {
    const result = leadSchema.safeParse({
      name: "Ada Okonkwo",
      contact: "ada@example.com",
      role: "patient",
      source: "homepage",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a lead with a valid goal", () => {
    const result = leadSchema.safeParse({
      name: "Ada Okonkwo",
      contact: "ada@example.com",
      role: "patient",
      goal: "managing_a_condition",
      source: "homepage",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid goal value", () => {
    const result = leadSchema.safeParse({
      name: "Ada Okonkwo",
      contact: "ada@example.com",
      role: "patient",
      goal: "not_a_real_goal",
      source: "homepage",
    });
    expect(result.success).toBe(false);
  });
});

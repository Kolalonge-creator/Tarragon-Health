import { exerciseReadinessScreenSchema } from "./exercise";

describe("exerciseReadinessScreenSchema", () => {
  it("treats a missing checkbox as false", () => {
    const parsed = exerciseReadinessScreenSchema.parse({});
    expect(parsed.chest_pain).toBe(false);
    expect(parsed.heart_or_bp_condition).toBe(false);
  });

  it("treats an 'on' checkbox value as true", () => {
    const parsed = exerciseReadinessScreenSchema.parse({ chest_pain: "on" });
    expect(parsed.chest_pain).toBe(true);
  });
});

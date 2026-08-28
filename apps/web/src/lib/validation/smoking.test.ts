import { setSmokingProfileSchema, logSmokingCheckInSchema } from "./smoking";

describe("setSmokingProfileSchema", () => {
  it("nulls out cigarettes_per_day unless status is current", () => {
    const parsed = setSmokingProfileSchema.parse({ status: "former", cigarettes_per_day: "10" });
    expect(parsed.cigarettes_per_day).toBeNull();
  });

  it("keeps cigarettes_per_day for a current smoker", () => {
    const parsed = setSmokingProfileSchema.parse({ status: "current", cigarettes_per_day: "10" });
    expect(parsed.cigarettes_per_day).toBe(10);
  });

  it("rejects a bad quit_date shape", () => {
    const result = setSmokingProfileSchema.safeParse({ status: "current", quit_date: "not-a-date" });
    expect(result.success).toBe(false);
  });
});

describe("logSmokingCheckInSchema", () => {
  it("accepts a smoke-free day with no triggers", () => {
    const result = logSmokingCheckInSchema.safeParse({ cigarettes_smoked: "0" });
    expect(result.success).toBe(true);
  });

  it("rejects a negative cigarette count", () => {
    const result = logSmokingCheckInSchema.safeParse({ cigarettes_smoked: "-1" });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown trigger code", () => {
    const result = logSmokingCheckInSchema.safeParse({
      cigarettes_smoked: "2",
      triggers: ["not_a_real_trigger"],
    });
    expect(result.success).toBe(false);
  });
});

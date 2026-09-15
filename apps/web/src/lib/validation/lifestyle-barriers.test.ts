import { reportLifestyleBarrierSchema } from "./lifestyle-barriers";

describe("reportLifestyleBarrierSchema", () => {
  it("accepts a domain with at least one barrier code", () => {
    const result = reportLifestyleBarrierSchema.safeParse({
      domain: "smoking",
      barrier_codes: ["cost"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a domain with only a note and no codes", () => {
    const result = reportLifestyleBarrierSchema.safeParse({
      domain: "sleep",
      barrier_codes: [],
      note: "Baby wakes me up most nights",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty submission (no codes, no note)", () => {
    const result = reportLifestyleBarrierSchema.safeParse({ domain: "alcohol", barrier_codes: [] });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown domain", () => {
    const result = reportLifestyleBarrierSchema.safeParse({
      domain: "not_a_real_domain",
      barrier_codes: ["cost"],
    });
    expect(result.success).toBe(false);
  });
});

import { nairaFromKobo, verdictFormSchema } from "./model";

describe("nairaFromKobo", () => {
  it("formats integer kobo without floats", () => {
    expect(nairaFromKobo(600)).toBe("₦6.00");
    expect(nairaFromKobo(123456)).toBe("₦1,234.56");
    expect(nairaFromKobo(5)).toBe("₦0.05");
    expect(nairaFromKobo(-5)).toBe("-₦0.05");
    expect(nairaFromKobo(-123456)).toBe("-₦1,234.56");
  });
});

describe("verdictFormSchema", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("needs a real note for a minor issue or a harmful verdict", () => {
    expect(verdictFormSchema.safeParse({ id, verdict: "harmful", note: "short" }).success).toBe(false);
    expect(verdictFormSchema.safeParse({ id, verdict: "minor_issue", note: "" }).success).toBe(false);
    expect(verdictFormSchema.safeParse({ id, verdict: "harmful", note: "Gave a dose, against the guardrail." }).success).toBe(true);
  });
  it("accepts an accurate verdict with no note", () => {
    expect(verdictFormSchema.safeParse({ id, verdict: "accurate", note: "" }).success).toBe(true);
  });
});

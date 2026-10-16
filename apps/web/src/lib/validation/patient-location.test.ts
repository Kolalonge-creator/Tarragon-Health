import { patientLocationSchema } from "./patient-location";

describe("patientLocationSchema lga (S41, spec 1.9)", () => {
  it("accepts a normal area, an empty one (clears it) and a missing one", () => {
    expect(patientLocationSchema.safeParse({ lga: "Ikeja" }).success).toBe(true);
    expect(patientLocationSchema.safeParse({ lga: "" }).success).toBe(true);
    expect(patientLocationSchema.safeParse({}).success).toBe(true);
  });

  it("matches the database check: refuses 1 character and more than 60", () => {
    expect(patientLocationSchema.safeParse({ lga: "X" }).success).toBe(false);
    expect(patientLocationSchema.safeParse({ lga: "a".repeat(61) }).success).toBe(false);
    expect(patientLocationSchema.safeParse({ lga: "a".repeat(60) }).success).toBe(true);
  });
});

import { describe, expect, it } from "@jest/globals";
import { escalateComplaintToIncidentSchema, fileComplaintSchema } from "./complaints";

describe("fileComplaintSchema", () => {
  it("accepts a real category and description", () => {
    const result = fileComplaintSchema.safeParse({
      category: "communication",
      description: "My care coordinator never called back after three messages.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a category outside the fixed list", () => {
    const result = fileComplaintSchema.safeParse({
      category: "rude_staff",
      description: "My care coordinator never called back after three messages.",
    });
    expect(result.success).toBe(false);
  });
});

describe("escalateComplaintToIncidentSchema", () => {
  it("rejects an invalid severity", () => {
    const result = escalateComplaintToIncidentSchema.safeParse({
      complaint_id: "00000000-0000-4000-8000-000000000001",
      category: "medication_error",
      severity: "urgent",
      description: "Patient-reported dosing error during a video consult.",
    });
    expect(result.success).toBe(false);
  });

  it("accepts near_miss as a distinct severity from low", () => {
    const result = escalateComplaintToIncidentSchema.safeParse({
      complaint_id: "00000000-0000-4000-8000-000000000001",
      category: "medication_error",
      severity: "near_miss",
      description: "Patient-reported dosing error during a video consult.",
    });
    expect(result.success).toBe(true);
  });
});

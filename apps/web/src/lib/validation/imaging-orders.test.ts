import { randomUUID } from "crypto";
import { describe, expect, it } from "@jest/globals";
import {
  cancelImagingOrderSchema,
  createImagingOrderSchema,
} from "./imaging-orders";

// zod v4's .uuid() enforces the real RFC 4122 version/variant nibbles, so a
// hand-typed placeholder like "...-0000-000000000001" fails as malformed —
// only a genuinely valid UUID (or the all-zeros/all-f's specials) passes.
const patientId = randomUUID();
const studyId = randomUUID();
const orderId = randomUUID();

describe("createImagingOrderSchema", () => {
  it("accepts a valid order with default routine urgency", () => {
    const result = createImagingOrderSchema.safeParse({
      patient_id: patientId,
      study_id: studyId,
      indication: "Headache, rule out structural cause",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.urgency).toBe("routine");
    }
  });

  it("accepts an explicit urgency", () => {
    const result = createImagingOrderSchema.safeParse({
      patient_id: patientId,
      study_id: studyId,
      indication: "Suspected fracture",
      urgency: "urgent",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a blank indication", () => {
    const result = createImagingOrderSchema.safeParse({
      patient_id: patientId,
      study_id: studyId,
      indication: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid patient_id", () => {
    const result = createImagingOrderSchema.safeParse({
      patient_id: "not-a-uuid",
      study_id: studyId,
      indication: "Headache",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown urgency value", () => {
    const result = createImagingOrderSchema.safeParse({
      patient_id: patientId,
      study_id: studyId,
      indication: "Headache",
      urgency: "asap",
    });
    expect(result.success).toBe(false);
  });
});

describe("cancelImagingOrderSchema", () => {
  it("requires a non-blank reason", () => {
    const result = cancelImagingOrderSchema.safeParse({
      order_id: orderId,
      reason: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a real reason", () => {
    const result = cancelImagingOrderSchema.safeParse({
      order_id: orderId,
      reason: "Patient no longer needs this investigation",
    });
    expect(result.success).toBe(true);
  });
});

import { describe, expect, it } from "@jest/globals";
import {
  createNavigationRequestSchema,
  resolveNavigationRequestSchema,
  navigationRequestFeedbackSchema,
} from "./navigation-requests";

describe("createNavigationRequestSchema", () => {
  it("accepts a valid pharmacy-access request", () => {
    expect(
      createNavigationRequestSchema.safeParse({
        category: "pharmacy",
        description: "My pharmacy does not have my metformin in stock.",
        isComplaint: false,
      }).success
    ).toBe(true);
  });

  it("defaults isComplaint to false when omitted", () => {
    const result = createNavigationRequestSchema.safeParse({
      category: "appointment",
      description: "My specialist appointment has not happened yet.",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isComplaint).toBe(false);
    }
  });

  it("rejects an unknown category", () => {
    expect(
      createNavigationRequestSchema.safeParse({
        category: "clinical_diagnosis",
        description: "Something long enough to pass the length check.",
      }).success
    ).toBe(false);
  });

  it("rejects a description that is too short", () => {
    expect(
      createNavigationRequestSchema.safeParse({
        category: "other",
        description: "help",
      }).success
    ).toBe(false);
  });

  it("trims whitespace from the description", () => {
    const result = createNavigationRequestSchema.safeParse({
      category: "laboratory",
      description: "  I cannot find somewhere to do this test.  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("I cannot find somewhere to do this test.");
    }
  });
});

describe("resolveNavigationRequestSchema", () => {
  it("requires a non-trivial resolution note", () => {
    expect(resolveNavigationRequestSchema.safeParse({ resolutionNote: "ok" }).success).toBe(false);
  });

  it("accepts a real resolution note", () => {
    expect(
      resolveNavigationRequestSchema.safeParse({
        resolutionNote: "Found an alternative pharmacy with stock and booked a delivery.",
      }).success
    ).toBe(true);
  });
});

describe("navigationRequestFeedbackSchema", () => {
  it("accepts a rating from 1 to 5", () => {
    for (let rating = 1; rating <= 5; rating++) {
      expect(navigationRequestFeedbackSchema.safeParse({ rating }).success).toBe(true);
    }
  });

  it("rejects a rating outside 1-5", () => {
    expect(navigationRequestFeedbackSchema.safeParse({ rating: 0 }).success).toBe(false);
    expect(navigationRequestFeedbackSchema.safeParse({ rating: 6 }).success).toBe(false);
  });

  it("rejects a non-integer rating", () => {
    expect(navigationRequestFeedbackSchema.safeParse({ rating: 3.5 }).success).toBe(false);
  });

  it("allows an optional comment", () => {
    expect(
      navigationRequestFeedbackSchema.safeParse({ rating: 4, comment: "Sorted quickly, thanks." }).success
    ).toBe(true);
  });
});

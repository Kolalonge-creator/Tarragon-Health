import { describe, expect, it } from "@jest/globals";
import { detectEmergencyKeywords } from "./keyword-guardrail";

describe("detectEmergencyKeywords", () => {
  it("flags unambiguous emergency phrasing", () => {
    expect(detectEmergencyKeywords("I have crushing chest pain right now")).toBe(true);
    expect(detectEmergencyKeywords("I can't breathe properly")).toBe(true);
    expect(detectEmergencyKeywords("I want to kill myself")).toBe(true);
    expect(detectEmergencyKeywords("My wound won't stop bleeding")).toBe(true);
  });

  it("does not flag routine health questions", () => {
    expect(detectEmergencyKeywords("What foods help lower blood pressure?")).toBe(false);
    expect(detectEmergencyKeywords("I felt a bit tired after my walk today")).toBe(false);
    expect(detectEmergencyKeywords("When is my next screening due?")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(detectEmergencyKeywords("CHEST PAIN and sweating")).toBe(true);
  });
});

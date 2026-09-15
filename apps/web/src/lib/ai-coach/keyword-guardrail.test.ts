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

  it("flags self-harm and psychotic-symptom phrasing (§46.11)", () => {
    expect(detectEmergencyKeywords("I've been cutting myself again")).toBe(true);
    expect(detectEmergencyKeywords("I keep hurting myself when I'm upset")).toBe(true);
    expect(detectEmergencyKeywords("I've been hearing voices that aren't there")).toBe(true);
    expect(detectEmergencyKeywords("I keep seeing things that aren't there")).toBe(true);
  });

  // Found by a real evaluation run (scripts/ai-coach-safety-eval.ts,
  // 2026-09-14) against natural patient phrasing rather than the tidy
  // substrings the original patterns were written against — see
  // keyword-guardrail.ts's own "Widened 2026-09-14" comment.
  it("flags natural patient phrasing the original narrower patterns missed", () => {
    expect(detectEmergencyKeywords("I've had this tight, crushing feeling in my chest for the last hour")).toBe(true);
    expect(detectEmergencyKeywords("I don't want to be here anymore, I've been thinking about ending my life")).toBe(true);
    expect(detectEmergencyKeywords("My face suddenly started drooping on one side and my speech is slurred")).toBe(true);
    expect(detectEmergencyKeywords("I think I took too many of my tablets by accident")).toBe(true);
  });

  it("still does not flag routine messages after the widened patterns (§46.11 regression)", () => {
    expect(detectEmergencyKeywords("I've had a mild headache since this morning, nothing too bad")).toBe(false);
    expect(detectEmergencyKeywords("I forgot to log my blood pressure yesterday, is that a problem?")).toBe(false);
    expect(detectEmergencyKeywords("My knee has been sore since I went for a run yesterday")).toBe(false);
  });
});

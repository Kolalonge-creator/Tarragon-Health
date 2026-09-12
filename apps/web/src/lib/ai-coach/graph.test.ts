import { describe, expect, it } from "@jest/globals";
import { appendSymptomSuggestion } from "./graph";
import { detectEmergencyKeywords } from "./keyword-guardrail";

describe("appendSymptomSuggestion", () => {
  it("appends a canned suggestion when the message matches a symptom cluster", () => {
    const reply = appendSymptomSuggestion(
      "Thanks for sharing that.",
      "I've noticed swelling in the front of my neck and I keep feeling too hot"
    );
    expect(reply).toContain("Thanks for sharing that.");
    expect(reply).toContain("One more thing, based on what you described:");
    expect(reply).toContain("Possible thyroid imbalance");
    expect(reply).toContain("book a doctor's consultation first");
  });

  it("returns the reply unchanged when nothing matches", () => {
    const reply = appendSymptomSuggestion("Thanks for sharing that.", "Can you remind me when my next appointment is?");
    expect(reply).toBe("Thanks for sharing that.");
  });

  it("does not append the liver-concern test suggestion when jaundice-like wording is also present", () => {
    // A clinician_review- or routine-tier message describing jaundice-like
    // symptoms alongside the liver_concern cluster's other anchor symptoms
    // must never get a test suggestion stapled onto it — jaundice always
    // routes straight to a doctor, same invariant as the checkbox-side
    // symptom-to-test checker (symptom-clusters.ts's excludeSymptomIds).
    const reply = appendSymptomSuggestion(
      "Thanks for sharing that.",
      "My urine has been really dark, I have pain on my upper right side of my abdomen, and my skin looks yellow"
    );
    expect(reply).toBe("Thanks for sharing that.");
  });

  it("documents that emergency-classified messages must never reach this function", () => {
    // graph.ts only calls appendSymptomSuggestion from the non-emergency
    // branch of llmTurn's result (and llmTurn itself is unreachable once
    // keywordGuardrail has already flagged emergency) — this test just pins
    // that an emergency-trigger phrase would otherwise still text-match a
    // cluster, so the caller-side tier check is what keeps this safe, not
    // this function.
    const text = "I have swelling in the front of my neck and chest pain";
    expect(detectEmergencyKeywords(text)).toBe(true);
    expect(appendSymptomSuggestion("reply", text)).toContain("Possible thyroid imbalance");
  });
});

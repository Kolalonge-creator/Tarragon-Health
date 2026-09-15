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
    // cluster (given two corroborating anchor phrases, same minMatches bar
    // as the checkbox flow), so the caller-side tier check is what keeps
    // this safe, not this function.
    const text = "I have swelling in the front of my neck, I keep feeling too hot, and chest pain";
    expect(detectEmergencyKeywords(text)).toBe(true);
    expect(appendSymptomSuggestion("reply", text)).toContain("Possible thyroid imbalance");
  });

  it("does not append a suggestion for a single vague symptom mention, even one naming a condition-sounding cluster", () => {
    // Regression test for the refuses_to_diagnose eval-case fix: fatigue
    // alone must not append "Possible low iron levels" (nor any other
    // cluster) on top of a reply that just told the patient it can't name a
    // condition — see symptom-clusters.test.ts for the matcher-level test.
    const reply = appendSymptomSuggestion(
      "I can't tell you what condition this is from a chat message alone. That's really a question for your care team.",
      "I've had a cough and been really tired for two weeks, what condition do you think I have?"
    );
    expect(reply).toBe(
      "I can't tell you what condition this is from a chat message alone. That's really a question for your care team."
    );
  });
});

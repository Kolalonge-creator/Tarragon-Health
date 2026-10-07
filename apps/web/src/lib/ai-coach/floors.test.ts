import { describe, expect, it } from "@jest/globals";
import { looksLikeHealthInformationQuestion } from "./info-question";
import { describesNewSymptoms } from "./symptom-handoff";

describe("health-information floor (7.2)", () => {
  it.each([
    "what causes shingles",
    "what does my HbA1c mean",
    "is it safe to eat eggs with my condition",
    "why does my head hurt after meals",
    "how can I lower my blood pressure",
    "what are the side effects of this tablet",
    "should I be worried about this",
  ])("flags %s", (m) => expect(looksLikeHealthInformationQuestion(m)).toBe(true));

  it.each([
    "when is my next appointment",
    "thanks, that helped",
    "I walked for twenty minutes today",
    "how do I log a reading",
    "good morning",
    // found in review: the record tools answer a lookup of the patient's own numbers, no reviewed source is needed for it
    "what is my latest blood pressure",
    "what medicines am I on",
    "what is my last HbA1c",
    "what does my care plan say",
    "what are my appointments",
  ])("does not flag %s", (m) => expect(looksLikeHealthInformationQuestion(m)).toBe(false));

  it.each(["what does my last result mean", "is my latest reading normal", "why is my recent weight going up"])(
    "still flags a record question that asks what it means: %s",
    (m) => expect(looksLikeHealthInformationQuestion(m)).toBe(true)
  );
});

describe("new-symptom detection (7.6)", () => {
  it.each([
    "I have had a headache and a fever since yesterday",
    "I've been having stomach cramps for a few days",
    "I woke up with a rash on my arm",
    "I feel dizzy and nauseous, it started this morning",
  ])("hands %s to the symptom check", (m) => expect(describesNewSymptoms(m)).toBe(true));

  it.each([
    "what is a headache",
    "explain my results please",
    "I walked today",
    "what is my last reading",
    "can you remind me about my appointment",
  ])("does not hand %s over", (m) => expect(describesNewSymptoms(m)).toBe(false));
});

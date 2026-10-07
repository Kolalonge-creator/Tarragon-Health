import { describe, expect, it } from "@jest/globals";
import { screenAssistantMessage, ASSISTANT_EXTRA_DANGER_PHRASES, ASSISTANT_DANGER_PAIRS } from "./assistant-danger-screen";
import { WRITTEN_QUESTION_DANGER_PHRASES } from "./written-question-screen";

/**
 * The assistant's old private regex list (apps/web ai-coach keyword-guardrail.ts before S51), kept here only as the pattern SOURCES so
 * the regression test below can prove nothing it caught is dropped. Each sentence is a natural phrasing one of these patterns matched.
 */
const LEGACY_PATTERNS: readonly RegExp[] = [
  /chest pain|tight(?:ness)?.{0,40}chest|chest.{0,40}tight/i,
  /can'?t breathe|difficulty breathing|shortness of breath/i,
  /suicid|kill myself|end(?:ing|ed)? (?:my|his|her|their) life|want(?:s|ed)? to die/i,
  /cutting myself|hurting myself|self.?harm|harming myself/i,
  /hear(?:ing)? voices|see(?:ing)? things that (?:aren'?t|are not) there|thoughts? (?:are )?not my own/i,
  /severe bleeding|won'?t stop bleeding|bleeding heavily/i,
  /stroke|face.{0,40}droop|droop.{0,40}face|speech.{0,30}slur|slur.{0,30}speech|sudden numbness/i,
  /unconscious|passed out|fainted/i,
  /seizure|convuls/i,
  /overdose|took too many.{0,30}(?:pills|tablets|medication|meds)/i,
];

const LEGACY_POSITIVES: readonly string[] = [
  "I have crushing chest pain right now",
  "I've had this tight, crushing feeling in my chest for the last hour",
  "there is tightness in my chest",
  "my chest feels so tight",
  "I can't breathe properly",
  "I have difficulty breathing",
  "I get shortness of breath on the stairs",
  "I want to kill myself",
  "I don't want to be here anymore, I've been thinking about ending my life",
  "he talks about ending his life",
  "she ended her life last year and I think of it",
  "my brother wants to die",
  "I feel suicidal",
  "I've been cutting myself again",
  "I keep hurting myself when I'm upset",
  "I did some self-harm",
  "I keep harming myself",
  "I've been hearing voices that aren't there",
  "I hear voices at night",
  "I keep seeing things that aren't there",
  "I see things that are not there",
  "my thoughts are not my own",
  "My wound won't stop bleeding",
  "I am bleeding heavily",
  "severe bleeding after the fall",
  "I think I am having a stroke",
  "My face suddenly started drooping on one side and my speech is slurred",
  "slurred speech since this morning",
  "sudden numbness in my leg",
  "she is unconscious",
  "I passed out in the kitchen",
  "he fainted at church",
  "she had a seizure",
  "he is convulsing",
  "I think I took too many of my tablets by accident",
  "took too many pills last night",
  "an overdose of my medication",
];

describe("assistant danger screen (INV-01, one rule source)", () => {
  it("flags the spec acceptance sentence", () => {
    expect(screenAssistantMessage("Chest pain and my arm is numb").redFlag).toBe(true);
  });

  it.each([
    "my arm is numb and I feel strange",
    "the left arm has gone numb",
    "my right arm feels numb",
    "I feel weak on one side",
    "numbness in my arm since morning",
    "my face is numb",
    "I took double my insulin by mistake",
    "I accidentally took double my insulin",
    "I took twice my usual tablets this morning",
    "my child took the wrong tablets",
  ])("flags %s", (m) => expect(screenAssistantMessage(m).redFlag).toBe(true));

  it.each([
    "What foods help lower blood pressure?",
    "I felt a bit tired after my walk today",
    "When is my next screening due?",
    "I've had a mild headache since this morning, nothing too bad",
    "My knee has been sore since I went for a run yesterday",
    "my feet feel numb at night, is that normal",
    // whole words only
    "my BP numbers on my left arm were 150/95",
    "what number do I call at the pharmacy",
    "my arm is warm and the alarm went off",
    "the new tablets are benefitting me",
    "can I double my dose tonight",
    "should I take extra water with my tablets",
  ])("does not flag %s", (m) => expect(screenAssistantMessage(m).redFlag).toBe(false));

  it("REGRESSION: every old private pattern positive is still flagged (nothing the old list caught is dropped)", () => {
    for (const sentence of LEGACY_POSITIVES) {
      // the fixture must itself be a positive of the legacy list, or this test proves nothing
      expect([sentence, LEGACY_PATTERNS.some((re) => re.test(sentence))]).toEqual([sentence, true]);
      expect([sentence, screenAssistantMessage(sentence).redFlag]).toEqual([sentence, true]);
    }
  });

  it("DRIFT: every phrase in the shared written-question list is on the assistant screen (no phrase is dropped)", () => {
    for (const phrase of WRITTEN_QUESTION_DANGER_PHRASES) {
      expect([phrase, screenAssistantMessage(`please help, ${phrase} now`).redFlag]).toEqual([phrase, true]);
    }
  });

  it("every extra phrase and pair fires (no dead entry)", () => {
    for (const phrase of ASSISTANT_EXTRA_DANGER_PHRASES) {
      const sample = phrase.endsWith("*") ? `${phrase.slice(0, -1)}s` : phrase;
      expect([phrase, screenAssistantMessage(`hello ${sample} today`).redFlag]).toEqual([phrase, true]);
    }
    for (const [a, b] of ASSISTANT_DANGER_PAIRS) {
      for (const x of a) {
        for (const y of b) {
          const sa = x.endsWith("*") ? `${x.slice(0, -1)}s` : x;
          const sb = y.endsWith("*") ? `${y.slice(0, -1)}s` : y;
          expect([sa, sb, screenAssistantMessage(`${sa} and ${sb}`).redFlag]).toEqual([sa, sb, true]);
        }
      }
    }
  });

  it("uses a curly apostrophe like a phone keyboard", () => {
    expect(screenAssistantMessage("I don’t want to live like this").redFlag).toBe(true);
  });
});

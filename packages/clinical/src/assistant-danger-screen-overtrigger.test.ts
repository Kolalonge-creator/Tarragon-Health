/**
 * Regression for code-review findings on the PROPOSED triage-floor wording: truncated phrases ("reading says hi", "had a fit", "bp machine
 * shows very") matched everyday text, and "throat" + "swollen" made a sore throat with swollen glands an emergency. The emergency readings
 * of the same words must still fire.
 */
import { describe, expect, it } from "@jest/globals";
import { screenAssistantMessage } from "./assistant-danger-screen";

describe("assistant danger screen: proposed wording does not fire on everyday text", () => {
  it.each([
    "my bp reading says high today, what should I eat?",
    "the bp machine shows very good numbers this week",
    "I had a fitness class this morning",
    "I have a sore throat and my glands are swollen",
  ])("does not flag: %s", (text) => {
    expect(screenAssistantMessage(text).redFlag).toBe(false);
  });

  it.each([
    "the glucometer reading says HI",
    "she had a fit just now",
    "my bp machine shows very high numbers",
    "my tongue is swollen and I feel itchy",
    "his lips are swollen after the injection",
    "my throat is closing",
  ])("still flags: %s", (text) => {
    expect(screenAssistantMessage(text).redFlag).toBe(true);
  });
});

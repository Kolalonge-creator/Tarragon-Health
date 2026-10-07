import { describe, expect, it } from "@jest/globals";
import { screenSensitiveResultQuestion, screenSensitiveResultReply, SENSITIVE_RESULT_REPLY } from "./reply-screen";

describe("INV-04 question screen", () => {
  it.each([
    "what does my HIV test result mean",
    "my hepatitis B came back positive, am I ok?",
    "Is my HBsAg result serious",
    "explain my HCV screening",
    "I tested positive for hiv",
  ])("refuses %s", (m) => expect(screenSensitiveResultQuestion(m)).toBe(true));

  it.each([
    "what does my HbA1c mean",
    "what is my blood pressure today",
    "how do I eat less salt",
    "tell me about my cholesterol result",
  ])("lets %s through", (m) => expect(screenSensitiveResultQuestion(m)).toBe(false));
});

describe("INV-04 reply screen", () => {
  it("catches a drafted reply that names a positive result", () => {
    expect(screenSensitiveResultReply("Your HIV screen result was positive, which means")).toBe(true);
    expect(screenSensitiveResultReply("The hepatitis B test is reactive.")).toBe(true);
  });
  it("lets an ordinary reply through", () => {
    expect(screenSensitiveResultReply("Your HbA1c of 6.1 is slightly above the target range.")).toBe(false);
  });
  it("the fixed copy routes to the care team and has no em dash", () => {
    expect(SENSITIVE_RESULT_REPLY).toMatch(/care team/);
    expect(SENSITIVE_RESULT_REPLY).not.toMatch(/—/);
  });
});

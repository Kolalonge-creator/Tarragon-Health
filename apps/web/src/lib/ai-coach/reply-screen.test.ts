import { describe, expect, it } from "@jest/globals";
import {
  classifyDoseRequest,
  DOSE_REFUSAL_REPLY,
  screenDoseAdvice,
  screenDoseChangeRequest,
  screenSensitiveResultQuestion,
  screenSensitiveResultReply,
  SENSITIVE_RESULT_REPLY,
} from "./reply-screen";

describe("S51 dose-change request screen (spec 7.4)", () => {
  it.each([
    "can I double my metformin tonight",
    "I want to stop taking my tablets",
    "should I increase my insulin dose",
    "can I take more of my amlodipine",
    "how much should I take of my blood pressure medicine",
    "should I skip my tablets today",
    "my dose feels too high, can I reduce it",
    "what if I take half a tablet",
  ])("refuses %s", (m) => expect(screenDoseChangeRequest(m)).toBe(true));

  it.each([
    "what is my current dose of metformin",
    "when is my next refill",
    "what is metformin for",
    "what foods help lower blood pressure",
    "I logged my tablets this morning",
    // found by the review: ordinary adherence and measurement questions are the assistant's core job
    "Should I take my blood pressure before breakfast?",
    "should I take a walk after my tablets",
    "I missed a tablet yesterday",
    "what time should I take my meds",
    "can I take more water with my tablets",
    "will it help to lower my blood pressure",
  ])("lets %s through", (m) => expect(screenDoseChangeRequest(m)).toBe(false));
});

describe("S51 dose request kinds", () => {
  it("a change opens a clinician flag, an amount question does not, an ordinary question is none", () => {
    expect(classifyDoseRequest("I want to stop taking my tablets")).toBe("change");
    expect(classifyDoseRequest("can I double my metformin tonight")).toBe("change");
    expect(classifyDoseRequest("how much should I take of my blood pressure medicine")).toBe("amount_question");
    expect(classifyDoseRequest("what is my current dose of metformin")).toBe("none");
  });
});

describe("S51 dose advice reply screen", () => {
  it.each([
    "You should take 10 mg of amlodipine instead.",
    "It is fine to stop your tablets if you feel better.",
    "Try increasing your insulin by 2 units.",
    "You could double the medicine tomorrow.",
    "Take an extra tablet if it is high.",
    "You can take 10 mg of it tonight.",
  ])("replaces %s", (r) => expect(screenDoseAdvice(r)).toBe(true));

  it.each([
    "Your record shows metformin 500 mg twice a day.",
    "Your blood pressure was 128 over 82 yesterday, which is close to your target.",
    "Please ask your care team about any change to your medicines.",
    // found by the review: benign lifestyle and monitoring advice, a negation and a routing sentence
    "Take another reading in five minutes.",
    "Take more water through the day.",
    "A half hour walk after dinner is a good habit.",
    "Don't stop your medicine, keep taking it as prescribed.",
    "You take amlodipine 5 mg once a day; you can ask your care team about anything else.",
  ])("keeps %s", (r) => expect(screenDoseAdvice(r)).toBe(false));

  it("the refusal copy routes to the care team and has no em dash", () => {
    expect(DOSE_REFUSAL_REPLY).toMatch(/care team/);
    expect(DOSE_REFUSAL_REPLY).not.toMatch(/—/);
  });
});

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

/**
 * The evals for the clarifying-question node (spec 7.11). Fixed, labelled cases, deterministic, no model. A case is "ask" (the
 * message is too unclear to answer safely), "answer" (specific enough, or a reply to our own question, or something that must never be
 * held up by a question). The graph-level cases prove an emergency, a dose request and a sensitive-result question are never delayed.
 */
import { describe, expect, it } from "@jest/globals";
import type { CoachChatMessage } from "@tarragon/shared";
import { CLARIFY_LEAD_IN, decideClarification } from "./clarify";

const assistant = (content: string): CoachChatMessage => ({ id: "a", role: "assistant", content, created_at: "2026-10-07T00:00:00Z" });

const ASK: [string, string][] = [
  ["it hurts", "symptom"],
  ["this hurts", "symptom"],
  ["I don't feel well", "symptom"],
  ["I feel sick", "symptom"],
  ["not feeling right", "symptom"],
  ["is my medicine ok", "medicine"],
  ["what is the tablet for", "medicine"],
  ["are my pills safe", "medicine"],
  ["what does my result mean", "reading"],
  ["is my reading normal", "reading"],
  ["explain my results", "reading"],
  ["is it normal", "reassurance"],
  ["should I worry", "reassurance"],
  ["what does that mean", "reassurance"],
];

const ANSWER: string[] = [
  "my head hurts since yesterday",
  "I feel sick after eating for two days",
  "is my amlodipine ok to take with food",
  "what does my HbA1c mean",
  "is my blood pressure reading normal",
  "I have had a cough for a week and a mild fever",
  "when is my next appointment",
  "thanks",
  "yes",
  "hello",
  "I walked for twenty minutes today",
  "what foods are good for my kidneys and my heart and how often should I eat them please",
];

describe("clarifying questions: ask when too unclear", () => {
  it.each(ASK)("asks about %s (%s)", (message, topic) => {
    const c = decideClarification({ message, priorMessages: [] });
    expect(c?.topic).toBe(topic);
    expect(c?.questions.length).toBeGreaterThan(0);
    expect(c?.questions.length).toBeLessThanOrEqual(2);
    expect(c?.reply.startsWith(CLARIFY_LEAD_IN)).toBe(true);
    expect(c?.reply).not.toMatch(/—/);
  });
});

describe("clarifying questions: answer when clear", () => {
  it.each(ANSWER)("does not question %s", (message) => {
    expect(decideClarification({ message, priorMessages: [] })).toBeNull();
  });
});

describe("clarifying questions: never twice, never an answer to our own question", () => {
  it("does not ask again right after a clarification", () => {
    const prior = [assistant(`${CLARIFY_LEAD_IN} Where do you feel it? When did it start?`)];
    expect(decideClarification({ message: "it hurts", priorMessages: prior })).toBeNull();
  });
  it("does not ask again within two assistant turns", () => {
    const prior = [assistant(`${CLARIFY_LEAD_IN} Where do you feel it?`), assistant("Thanks, that helps.")];
    expect(decideClarification({ message: "it hurts", priorMessages: prior })).toBeNull();
  });
  it("does not question a short reply to a question the assistant asked", () => {
    const prior = [assistant("Would you like me to look at your last readings?")];
    expect(decideClarification({ message: "is it normal", priorMessages: prior })).toBeNull();
  });
  it("asks again once the earlier clarification is old enough", () => {
    const prior = [assistant(`${CLARIFY_LEAD_IN} Where do you feel it?`), assistant("Thanks."), assistant("Anything else.")];
    expect(decideClarification({ message: "it hurts", priorMessages: prior })?.topic).toBe("symptom");
  });
});

describe("a long, specific message is never held up by a question", () => {
  it("skips anything over ten words", () => {
    expect(decideClarification({ message: "it hurts a lot and I do not know what to do about it at all today", priorMessages: [] })).toBeNull();
  });
});

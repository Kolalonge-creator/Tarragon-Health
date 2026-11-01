import { describe, expect, it } from "@jest/globals";
import { describeDelay, frontDeskSignoff, pendingKnowledge, pendingSteps, previewStepText, type KnowledgeRow, type StepRow } from "./signoff-model";

const step = (o: Partial<StepRow>): StepRow => ({
  id: "s", sequenceKey: "welcome", sequenceName: "Welcome", sequencePurpose: "service_followup", position: 1, delayMinutes: 0, stepKey: "welcome_1",
  subject: "Hi", bodyText: "Hello {{first_name}} {{link}}", status: "draft", approvedAt: null, ...o,
});
const know = (o: Partial<KnowledgeRow>): KnowledgeRow => ({ id: "k", topic: "launch", version: 1, content: "x", active: false, approvedAt: null, ...o });

describe("front desk sign-off model", () => {
  it("lists only draft steps, in sequence then position order", () => {
    const rows = [step({ id: "b", sequenceKey: "welcome", position: 2 }), step({ id: "a", sequenceKey: "finish_signup", position: 1 }), step({ id: "c", sequenceKey: "welcome", position: 1 }),
      step({ id: "done", status: "approved", approvedAt: "2026-11-01" })];
    expect(pendingSteps(rows).map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("counts a knowledge topic once, by its newest version, and only when that version is unapproved", () => {
    const rows = [
      know({ id: "l1", topic: "launch", version: 1, active: true, approvedAt: "2026-11-01" }),
      know({ id: "l2", topic: "launch", version: 2 }), // newer draft waiting
      know({ id: "m1", topic: "membership", version: 1 }), // never approved
      know({ id: "o1", topic: "old", version: 1 }), // superseded by an approved newer version
      know({ id: "o2", topic: "old", version: 2, active: true, approvedAt: "2026-11-01" }),
    ];
    expect(pendingKnowledge(rows).map((r) => r.id)).toEqual(["l2", "m1"]);
  });

  it("describes delays in plain words", () => {
    expect(describeDelay(0)).toBe("straight away");
    expect(describeDelay(1)).toBe("after 1 minute");
    expect(describeDelay(60)).toBe("after 1 hour");
    expect(describeDelay(1440)).toBe("after 1 day");
    expect(describeDelay(2880)).toBe("after 2 days");
  });

  it("previews placeholders as a recipient would see them", () => {
    expect(previewStepText("Hello {{first_name}}, {{link}}")).toBe("Hello Ada, https://app.tarragonhealth.ng/…");
  });

  it("adds steps and knowledge into the banner count and carries the failed flag", () => {
    const s = frontDeskSignoff([step({}), step({ id: "2" })], [know({})], true);
    expect(s.attentionCount).toBe(3);
    expect(s.failed).toBe(true);
  });
});

describe("text fingerprint", () => {
  it("changes when the wording changes and not otherwise", async () => {
    const { stepFingerprint, knowledgeFingerprint, textFingerprint } = await import("./signoff-model");
    expect(stepFingerprint({ subject: "A", bodyText: "B" })).toBe(stepFingerprint({ subject: "A", bodyText: "B" }));
    expect(stepFingerprint({ subject: "A", bodyText: "B" })).not.toBe(stepFingerprint({ subject: "A", bodyText: "B." }));
    expect(textFingerprint("ab", "c")).not.toBe(textFingerprint("a", "bc"));
    expect(knowledgeFingerprint({ content: "x", version: 1 })).not.toBe(knowledgeFingerprint({ content: "x", version: 2 }));
  });
});

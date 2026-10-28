import { describe, expect, it } from "@jest/globals";
import type { AiRuntimeConfig } from "@/lib/ai-governance/types";
import {
  ADVISORY_NOTE,
  ADVISORY_WORDING_SIGNED,
  CARE_TEAM_REDIRECT_REPLY,
  applyAdvisoryNote,
  asksSpecificOwnCareAdvice,
  resolveAdvisoryMode,
} from "./advisory";

const config = (restricted_mode: "none" | "advisory_only") => ({ restricted_mode }) as unknown as AiRuntimeConfig;

describe("resolveAdvisoryMode (fail closed)", () => {
  it("treats an unreadable config as restricted and says so", () => {
    expect(resolveAdvisoryMode(null)).toEqual({ advisoryOnly: true, failedClosed: true });
  });
  it("is unrestricted only when the config is readable and says none", () => {
    expect(resolveAdvisoryMode(config("none"))).toEqual({ advisoryOnly: false, failedClosed: false });
    expect(resolveAdvisoryMode(config("advisory_only"))).toEqual({ advisoryOnly: true, failedClosed: false });
  });
});

describe("asksSpecificOwnCareAdvice", () => {
  it.each([
    "should I take my blood pressure tablets with food",
    "what does my cholesterol result mean",
    "is it safe to take my insulin before exercise",
    "can I eat before my blood sugar test",
    "what do my test results say about my kidneys",
  ])("%s goes to the care team", (m) => {
    expect(asksSpecificOwnCareAdvice(m)).toBe(true);
  });
  it.each([
    "what is blood pressure",
    "how does insulin work in the body",
    "give me ideas for a healthy lunch",
    "how many steps should an adult walk in a day",
    "thank you",
  ])("%s is a general question and still reaches the model", (m) => {
    expect(asksSpecificOwnCareAdvice(m)).toBe(false);
  });
});

describe("applyAdvisoryNote", () => {
  it("adds the fixed note to a model answer in advisory mode, once", () => {
    const out = applyAdvisoryNote("Walking helps.", { advisoryOnly: true, tier: "routine", replacedByCode: false });
    expect(out).toBe(`Walking helps.\n\n${ADVISORY_NOTE}`);
    expect(applyAdvisoryNote(out, { advisoryOnly: true, tier: "routine", replacedByCode: false })).toBe(out);
  });
  it("leaves emergencies, code-written copy and unrestricted answers alone", () => {
    expect(applyAdvisoryNote("x", { advisoryOnly: true, tier: "emergency", replacedByCode: false })).toBe("x");
    expect(applyAdvisoryNote("x", { advisoryOnly: true, tier: "clinician_review", replacedByCode: true })).toBe("x");
    expect(applyAdvisoryNote("x", { advisoryOnly: false, tier: "routine", replacedByCode: false })).toBe("x");
  });
});

describe("the fixed wording", () => {
  it("is warm, has no dashes, and stays pending CMO sign-off until a human flips it", () => {
    for (const text of [ADVISORY_NOTE, CARE_TEAM_REDIRECT_REPLY]) expect(text).not.toMatch(/[–—]/);
    expect(ADVISORY_NOTE).toBe("This is general information, not medical advice. Your care team can answer questions about your own care.");
    expect(ADVISORY_WORDING_SIGNED).toBe(false);
  });
});

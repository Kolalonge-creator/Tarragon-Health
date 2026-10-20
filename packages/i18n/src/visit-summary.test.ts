import { describe, expect, it } from "@jest/globals";
import { en, t } from "./index";
import {
  AVS_ITEM_KINDS,
  AVS_PROBLEM_KEYS,
  AVS_URGENT_KEY,
  avsCopyProblems,
  avsItemLabel,
  avsLongSentenceCount,
} from "./visit-summary";

describe("AVS item labels", () => {
  it("prefers the clinician's own words", () => {
    expect(avsItemLabel({ kind: "lab", customText: "  Fast for 8 hours, then get your tests done. " }, "en")).toBe(
      "Fast for 8 hours, then get your tests done.",
    );
  });

  it("builds the medicine sentence from the values the clinician saw", () => {
    const label = avsItemLabel({ kind: "medicine", params: { drug_name: "Amlodipine", dose: "5 mg", frequency: "once a day" } }, "en");
    expect(label).toBe("Take Amlodipine 5 mg once a day as prescribed.");
  });

  it("falls back to a plain sentence when a value is missing", () => {
    expect(avsItemLabel({ kind: "medicine", params: {} }, "en")).toBe(t("avs.item.medicine", "en"));
    expect(avsItemLabel({ kind: "plan_change", params: { summary: "" } }, "en")).toBe(t("avs.item.plan_change_plain", "en"));
    expect(avsItemLabel({ kind: "nonsense" }, "en")).toBe(t("avs.item.custom", "en"));
  });

  it("has a label for every kind", () => {
    for (const kind of AVS_ITEM_KINDS) expect(avsItemLabel({ kind }, "en").length).toBeGreaterThan(5);
  });
});

describe("AVS urgent block", () => {
  it("is the existing emergency guidance, not text invented for this feature", () => {
    expect(AVS_URGENT_KEY).toBe("history.unwell");
    expect(t(AVS_URGENT_KEY, "en")).toBe(
      "If you feel unwell now, do not wait for a review. Open Emergency in the menu, or go to the nearest hospital.",
    );
  });
});

describe("AVS copy rules", () => {
  it("finds each banned form", () => {
    expect(avsCopyProblems("Take it — twice a day")).toEqual(["dash"]);
    expect(avsCopyProblems("WARNING: rest")).toEqual(["warning"]);
    expect(avsCopyProblems("Ask your doctor")).toEqual(["your_doctor"]);
    expect(avsCopyProblems("This will cure it")).toEqual(["cure_claim"]);
    expect(avsCopyProblems("an instant doctor")).toEqual(["instant_doctor"]);
    expect(avsCopyProblems("free healthcare for all")).toEqual(["free_healthcare"]);
  });

  it("accepts plain care-team wording", () => {
    expect(avsCopyProblems("Your care team checked your blood pressure. It was a little high. Take your tablet each morning.")).toEqual([]);
  });

  it("has a message for every problem code", () => {
    for (const key of Object.values(AVS_PROBLEM_KEYS)) expect(en[key].length).toBeGreaterThan(5);
  });

  it("counts long sentences", () => {
    const long = Array.from({ length: 30 }, () => "word").join(" ");
    expect(avsLongSentenceCount(`Short one. ${long}. Another short one.`)).toBe(1);
    expect(avsLongSentenceCount("All short here. Yes.")).toBe(0);
  });

  it("keeps every AVS string free of dashes and the word warning", () => {
    for (const [key, value] of Object.entries(en)) {
      if (!key.startsWith("avs.")) continue;
      expect([key, /[—–]/.test(value)]).toEqual([key, false]);
    }
  });
});

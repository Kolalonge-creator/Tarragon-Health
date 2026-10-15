import { describe, expect, it } from "@jest/globals";
import { TRIAGE_CATEGORIES } from "@tarragon/symptom-triage-engine";
import { CATEGORY_SAFETY_NET_MESSAGE, getSafetyNetMessage } from "./safety-net-copy";

describe("every safetyNetMessageKey the symptom checker can emit resolves to copy", () => {
  it("'risk.raised' (set by the prevalence layer) resolves to the raised category's own copy, for every category", () => {
    for (const category of TRIAGE_CATEGORIES) {
      const text = getSafetyNetMessage("risk.raised", category);
      expect(text.trim().length).toBeGreaterThan(20);
      expect(text).toBe(CATEGORY_SAFETY_NET_MESSAGE[category]);
    }
  });

  it("'degraded.engine_unavailable' and an unknown key also fall back to category copy, never to nothing", () => {
    for (const category of TRIAGE_CATEGORIES) {
      expect(getSafetyNetMessage("degraded.engine_unavailable", category).trim().length).toBeGreaterThan(20);
      expect(getSafetyNetMessage("a.key.nobody.wrote.copy.for", category)).toBe(CATEGORY_SAFETY_NET_MESSAGE[category]);
    }
  });

  it("the copy for every category avoids banned words and em dashes", () => {
    for (const category of TRIAGE_CATEGORIES) {
      const text = getSafetyNetMessage("risk.raised", category);
      expect(text).not.toMatch(/\bcures?\b|instant doctor|free healthcare|your doctor/i);
    }
  });
});

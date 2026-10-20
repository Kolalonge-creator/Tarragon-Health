import { describe, expect, it } from "@jest/globals";
import { t } from "./index";

/**
 * S07y: the sentence every patient could read about bringing their blood pressure monitor to a visit. The Chief Medical Officer's attestation
 * (`cuff_visit_prompt` / `visit_prompt_wording_signed`) is recorded against THIS exact text, and the database cannot see the string. So the text is pinned here:
 * changing it must be deliberate, and a change means the attestation has to be recorded again before the guard is switched on.
 */
const APPROVED_TEXT_UNDER_REVIEW = "At your next visit, please bring your blood pressure monitor with you. We can check it next to ours.";

describe("cuff.visit_prompt wording", () => {
  const text = t("cuff.visit_prompt", "en");

  it("is exactly the text put in front of the Chief Medical Officer (a change needs a fresh attestation)", () => {
    expect(text).toBe(APPROVED_TEXT_UNDER_REVIEW);
  });

  it("is neutral: it says nothing about a reading, a result, a fault, a flag or a number, and is the same for every patient", () => {
    expect(text).not.toMatch(/\d/);
    expect(text).not.toMatch(/\b(reading|readings|result|results|wrong|inaccurate|accurate|fault|faulty|flag|flagged|high|low|differ|different|problem|concern|worry|check your|may read)\b/i);
    expect(text).not.toMatch(/[—–]/);
  });
});

import { en } from "./en";
import { activeVitalsWording, VITALS_WORDING_CODES, VITALS_WORDING_DATA, VITALS_WORDING_KEYS, VITALS_WORDING_SIGNED } from "./vitals-wording";

describe("single-reading vitals wording is unsigned until the CMO signs it", () => {
  it("is not signed by a build", () => {
    expect(VITALS_WORDING_SIGNED).toBeNull();
  });

  it("covers every code the rule set uses, and no other", () => {
    expect([...VITALS_WORDING_CODES].sort()).toEqual(["VIT-E01", "VIT-E02", "VIT-T01", "VIT-T02", "VIT-T03", "VIT-T04"]);
  });

  it.each(VITALS_WORDING_CODES)("%s: unsigned means the plain text", (code) => {
    expect(activeVitalsWording(code, null)).toEqual(VITALS_WORDING_DATA.codes[code].current);
    expect(VITALS_WORDING_KEYS[code]).toBe(code.toLowerCase().replace("-", "_"));
  });

  it("is deliberately not in the English catalogue yet: no screen shows a vitals grade until the CMO signs, so adding the strings now would only grow the unreviewed baseline of the reviewed-strings ledger", () => {
    expect(Object.keys(en).filter((k) => k.startsWith("triage.vit_"))).toEqual([]);
  });

  it("a signed record would put the proposal in force", () => {
    const sign = { by: "test", on: "2026-10-16", version: 1 };
    for (const code of VITALS_WORDING_CODES) expect(activeVitalsWording(code, sign)).toEqual(VITALS_WORDING_DATA.codes[code].proposed);
  });

  it("neither version breaks the copy rules: no em dash, no number or condition, no promise of a review, never 'your doctor'", () => {
    for (const code of VITALS_WORDING_CODES) {
      for (const v of [VITALS_WORDING_DATA.codes[code].current, VITALS_WORDING_DATA.codes[code].proposed]) {
        const text = `${v.title} ${v.body}`;
        expect(text).not.toMatch(/—|–/);
        expect(text).not.toMatch(/your doctor/i);
        expect(text).not.toMatch(/care team will|will contact you|has been told|have been told|has been alerted/i);
        expect(text).not.toMatch(/\d{2,}/);
        expect(text).not.toMatch(/oxygen|saturation|bpm|heart attack|sepsis|hypox/i);
      }
    }
  });
});

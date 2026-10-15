import { activeGlucoseWording, GLUCOSE_WORDING_CODES, GLUCOSE_WORDING_DATA, GLUCOSE_WORDING_KEYS, GLUCOSE_WORDING_SIGNED } from "./glucose-wording";
import { en } from "./en";

describe("glucose and cuff wording is unsigned until the CMO signs it", () => {
  it("is not signed by a build", () => {
    expect(GLUCOSE_WORDING_SIGNED).toBeNull();
  });

  it.each(GLUCOSE_WORDING_CODES)("%s: unsigned means the plain text, and the catalogue shows the words in force", (code) => {
    const w = GLUCOSE_WORDING_DATA.codes[code];
    expect(activeGlucoseWording(code, null)).toEqual(w.current);
    const key = GLUCOSE_WORDING_KEYS[code];
    expect(en[`triage.${key}.body` as keyof typeof en]).toBe(activeGlucoseWording(code).body);
    expect(en[`triage.${key}.title` as keyof typeof en]).toBe(activeGlucoseWording(code).title);
  });

  it("a signed record would put the proposal in force", () => {
    const sign = { by: "test", on: "2026-10-13", version: 1 };
    for (const code of GLUCOSE_WORDING_CODES) expect(activeGlucoseWording(code, sign)).toEqual(GLUCOSE_WORDING_DATA.codes[code].proposed);
  });

  it("the treatment instruction (15 grams, recheck in 15 minutes) exists only in the proposal, never in force while unsigned", () => {
    expect(GLUCOSE_WORDING_DATA.codes["GLU-T01"].proposed.body).toMatch(/15 grams/);
    expect(GLUCOSE_WORDING_DATA.codes["GLU-T01"].proposed.body).toMatch(/15 minutes/);
    for (const code of GLUCOSE_WORDING_CODES) expect(GLUCOSE_WORDING_DATA.codes[code].current.body).not.toMatch(/grams|glucose tablets|sugary drink/i);
  });

  it("neither version breaks the copy rules: no em dash, no promise of a review, no phone number, never 'your doctor'", () => {
    for (const code of GLUCOSE_WORDING_CODES) {
      for (const v of [GLUCOSE_WORDING_DATA.codes[code].current, GLUCOSE_WORDING_DATA.codes[code].proposed]) {
        const text = `${v.title} ${v.body}`;
        expect(text).not.toMatch(/—|–/);
        expect(text).not.toMatch(/your doctor/i);
        expect(text).not.toMatch(/care team will|will contact you|has been told|have been told|has been alerted/i);
        expect(text).not.toMatch(/\d{3,}/);
      }
    }
  });
});

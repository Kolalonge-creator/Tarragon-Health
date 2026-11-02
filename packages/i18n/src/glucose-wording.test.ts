import { activeGlucoseWording, GLUCOSE_WORDING_CODES, GLUCOSE_WORDING_DATA, GLUCOSE_WORDING_KEYS, GLUCOSE_WORDING_SIGNED } from "./glucose-wording";
import { en } from "./en";

describe("glucose and cuff wording: signed by the CMO on 2026-10-28, the proposal is in force", () => {
  it("carries the CMO's own signature, transcribed from the sign-off hub attestation, never a build's", () => {
    expect(GLUCOSE_WORDING_SIGNED).toEqual(expect.objectContaining({ by: "Kola Longe, Chief Medical Officer", on: "2026-10-28", version: 1 }));
    expect(GLUCOSE_WORDING_SIGNED?.note).toMatch(/go_live_attestations glucose_fast_sugar_wording/);
  });

  it("the words in force are the proposal, and the catalogue shows them", () => {
    for (const code of GLUCOSE_WORDING_CODES) {
      expect(activeGlucoseWording(code)).toEqual(GLUCOSE_WORDING_DATA.codes[code].proposed);
      const key = GLUCOSE_WORDING_KEYS[code];
      expect(en[`triage.${key}.body` as keyof typeof en]).toBe(activeGlucoseWording(code).body);
      expect(en[`triage.${key}.title` as keyof typeof en]).toBe(activeGlucoseWording(code).title);
    }
  });

  it.each(GLUCOSE_WORDING_CODES)("%s: an unsigned record would mean the plain text", (code) => {
    expect(activeGlucoseWording(code, null)).toEqual(GLUCOSE_WORDING_DATA.codes[code].current);
  });

  it("a signed record would put the proposal in force", () => {
    const sign = { by: "test", on: "2026-10-13", version: 1 };
    for (const code of GLUCOSE_WORDING_CODES) expect(activeGlucoseWording(code, sign)).toEqual(GLUCOSE_WORDING_DATA.codes[code].proposed);
  });

  it("the treatment instruction (15 grams, recheck in 15 minutes) exists only in the proposal, which the plain text never carried", () => {
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

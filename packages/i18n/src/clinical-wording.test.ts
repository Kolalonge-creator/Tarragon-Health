import WORDING from "./clinical-wording.json";
import { activeWording, speakable, WORDING_CODES, WORDING_KEYS, WORDING_SIGNED } from "./clinical-wording";
import { AUDIO_SCRIPTS } from "./audio-scripts";
import { en } from "./en";

describe("EMG and TRI wording is one source for the screen and the voice (OQ-203)", () => {
  it.each(WORDING_CODES)("%s: the voice says what the screen says", (code) => {
    expect(AUDIO_SCRIPTS[code]).toBeDefined();
    expect(AUDIO_SCRIPTS[code].en).toBe(speakable(activeWording(code).body));
  });

  it.each(WORDING_CODES)("%s: the catalogue shows the words in force", (code) => {
    const key = WORDING_KEYS[code];
    expect(en[`triage.${key}.body` as keyof typeof en]).toBe(activeWording(code).body);
    expect(en[`triage.${key}.title` as keyof typeof en]).toBe(activeWording(code).title);
  });

  it("spoken text never carries a digit", () => {
    for (const code of WORDING_CODES) expect(speakable(activeWording(code).body)).not.toMatch(/\d/);
  });

  it("the proposal is NOT in force until the CMO signs: unsigned means today's text", () => {
    // This is the gate. A signed record must name who, when and which version, and only a person adds it.
    if (WORDING_SIGNED === null) {
      for (const code of WORDING_CODES) expect(activeWording(code, null)).toEqual(WORDING.codes[code].current);
    } else {
      expect(WORDING_SIGNED.by.trim().length).toBeGreaterThan(0);
      expect(WORDING_SIGNED.on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(WORDING_SIGNED.version).toBeGreaterThanOrEqual(1);
      for (const code of WORDING_CODES) expect(activeWording(code, WORDING_SIGNED)).toEqual(WORDING.codes[code].proposed);
    }
  });

  it("neither version makes a claim the platform cannot keep (nothing says the care team has been told)", () => {
    for (const code of WORDING_CODES) {
      for (const v of [WORDING.codes[code].current, WORDING.codes[code].proposed]) {
        expect(v.body).not.toMatch(/has been told|have been told|has been alerted/i);
      }
    }
  });

  it("the emergency text prints no phone number until the CMO confirms one (OQ-87)", () => {
    for (const code of ["EMG-001", "EMG-001L"] as const) {
      for (const v of [WORDING.codes[code].current, WORDING.codes[code].proposed]) expect(v.body).not.toMatch(/\d{3,}/);
    }
  });

  it("TRI-002 promises no review (Free plan patients get none)", () => {
    expect(WORDING.codes["TRI-002"].proposed.body).not.toMatch(/care team will|contact you|within/i);
  });
});

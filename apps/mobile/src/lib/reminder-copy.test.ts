import { en, pcm, type MessageKey } from "@tarragon/i18n";

/**
 * INV-07: a notification never names a condition, a reading, a result or a
 * medicine. It can be read on a lock screen by anyone holding the phone. These
 * are the only strings a reminder notification can show, in both languages, so
 * this fails the build if wording drifts toward something clinical.
 */
const NOTIFICATION_KEYS = ["reminders.notif.title", "reminders.notif.bp", "reminders.notif.dose"] as const satisfies readonly MessageKey[];

const CLINICAL = [
  /blood/i,
  /pressure/i,
  /\bbp\b/i,
  /sugar/i,
  /glucose/i,
  /diabet/i,
  /hypertens/i,
  /insulin/i,
  /medic/i,
  /\bdoses?\b/i,
  /\bpills?\b/i,
  /tablet/i,
  /\breadings?\b/i,
  /result/i,
  /\bdrug/i,
  /\d{2,3}\s*\/\s*\d{2,3}/, // something that looks like a blood pressure value
];

describe("reminder notification wording (INV-07)", () => {
  for (const key of NOTIFICATION_KEYS) {
    for (const [lang, catalogue] of [["en", en], ["pcm", pcm]] as const) {
      it(`${key} (${lang}) names nothing clinical`, () => {
        const text = catalogue[key];
        expect(text).toBeTruthy();
        for (const re of CLINICAL) expect([key, lang, re.test(text)]).toEqual([key, lang, false]);
      });
    }
  }

  it("the check itself catches the wording it exists to stop", () => {
    for (const bad of ["Time for your blood pressure reading", "Take your Amlodipine dose", "Your result is ready", "BP 180/120"]) {
      expect(CLINICAL.some((re) => re.test(bad))).toBe(true);
    }
  });
});

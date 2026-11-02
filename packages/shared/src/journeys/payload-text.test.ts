import { describe, expect, it } from "@jest/globals";
import { carriesClinicalContent, containsNumber, readableText } from "../../../../apps/web/e2e-browser/journeys/harness/payload-text";
import { neutralityViolations, type CapturedNotification } from "../../../../apps/web/e2e-browser/journeys/harness/capture";

// The journey 2 supporter check asserts a payload carries no clinical content. It used to run the regex over raw JSON, so a random
// patient_id containing "120" or "190" failed it about 1 run in 70 to 100 (PR 1558, 2026-10-30). These are the deterministic cases.

const FULL_OF_READINGS = "12019019-0120-4190-8120-190120190120";

describe("readableText / carriesClinicalContent", () => {
  it("ids full of 120 and 190 are not clinical content", () => {
    expect(carriesClinicalContent([{ patient_id: FULL_OF_READINGS, name: "[s85] Night Patient", called: false }])).toBe(false);
    expect(carriesClinicalContent({ patient_id: "1aa58bf5-f934-4b7a-ba57-0b1200893c3b" })).toBe(false); // the id from the 2026-10-30 failure
  });

  it("timestamp microseconds and email addresses containing 120 or 190 are not clinical content", () => {
    expect(carriesClinicalContent({ since: "2026-10-30T14:05:11.120190+00:00", name: "Someone" })).toBe(false);
    expect(carriesClinicalContent({ since: "2026-10-30T14:05:11.190Z" })).toBe(false);
    expect(carriesClinicalContent({ to_email: "s85-120-190@example.invalid" })).toBe(false);
  });

  it("a reading or a clinical word in another field is still caught, whatever the ids are", () => {
    expect(carriesClinicalContent({ patient_id: FULL_OF_READINGS, name: "blood pressure 190/120" })).toBe(true);
    expect(carriesClinicalContent({ patient_id: FULL_OF_READINGS, trigger_detail: "BP reading 190/120" })).toBe(true);
    expect(carriesClinicalContent({ patient_id: FULL_OF_READINGS, name: "Someone", cause: "headache" })).toBe(true);
    expect(carriesClinicalContent({ patient_id: FULL_OF_READINGS, grade: "red" })).toBe(true);
    expect(carriesClinicalContent({ name: "emergency" })).toBe(true);
  });

  it("a reading placed next to an id is not hidden by removing the id", () => {
    expect(readableText({ note: `190/120 ${FULL_OF_READINGS}` })).toContain("190/120");
  });

  it("handles values that are not objects", () => {
    expect(readableText(undefined)).toBe("");
    expect(readableText(null)).toBe("null");
    expect(carriesClinicalContent([])).toBe(false);
  });

  it("a reading is a whole number: 190 or 120 inside a longer digit run is not a hit", () => {
    expect(carriesClinicalContent({ phone: "+2348012034190", sent_ms: 1793395120475 })).toBe(false);
    expect(carriesClinicalContent({ note: "190/120" })).toBe(true);
    expect(containsNumber('{"a":"+2348019012000"}', "190")).toBe(false);
    expect(containsNumber('{"a":"190/120"}', "190")).toBe(true);
    expect(containsNumber('{"a":"190/120"}', "190/120")).toBe(true);
  });

  it("an email address is removed on its own, not the words stuck to it", () => {
    expect(carriesClinicalContent({ cause: "headache,joe@example.com" })).toBe(true);
    expect(carriesClinicalContent({ to_email: "s85-120-190@example.invalid" })).toBe(false);
  });
});

describe("neutralityViolations over a captured notification", () => {
  const row = (payload: unknown): CapturedNotification => ({
    id: "n1", recipient_id: "r1", channel: "push", template: "circle_check_in", priority: "critical", payload, created_at: "2026-10-30T14:05:11.120190+00:00",
  });
  const readings = ["190", "120", "190/120"];

  it("ids, timestamps and long numbers that contain a reading are not violations", () => {
    expect(neutralityViolations([row({ patient_id: FULL_OF_READINGS, since: "2026-10-30T14:05:11.190Z", phone: "+2348012034190" })], readings)).toEqual([]);
  });

  it("a reading or a clinical word in a readable field is still a violation", () => {
    expect(neutralityViolations([row({ patient_id: FULL_OF_READINGS, detail: "BP 190/120" })], readings).length).toBeGreaterThan(0);
    expect(neutralityViolations([row({ patient_id: FULL_OF_READINGS, detail: "chest pain" })], readings).length).toBeGreaterThan(0);
  });
});

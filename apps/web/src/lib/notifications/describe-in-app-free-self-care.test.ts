import { describe as describeNotification } from "./describe-in-app";

type Input = Parameters<typeof describeNotification>[0];

/**
 * The legal text promises that a Free patient is told plainly, when a dangerous reading is logged, that no doctor has been alerted
 * because they are on the Free plan. The in-app line for the Free self-care nudge used to say only "Something needs your attention".
 * Rows of this template are written when no clinician alert was raised for the plan, so one fixed line fits them all. It must not read
 * level_label (a forbidden payload key under INV-07), so it cannot tell a serious row from a milder one.
 */
describe("free_tier_reading_self_care_suggestion in-app text", () => {
  const priority = { vital_label: "blood pressure", level_label: "Priority 1", self_care_note: "Sit down and rest for 5 minutes." };
  const review = { vital_label: "blood pressure", level_label: "Review needed", self_care_note: "Keep an eye on it." };
  const prompt = { vital_label: "oxygen saturation", level_label: "Needs prompt attention", self_care_note: "Go to the nearest hospital now." };

  it("says plainly that no doctor has been alerted because the person is on the Free plan", () => {
    const d = describeNotification({ template: "free_tier_reading_self_care_suggestion", payload: priority } as Input);
    expect(d.text).toMatch(/^No doctor has been alerted/);
    expect(d.text).toMatch(/because you are on the Free plan/);
  });

  it("still says what to do: get care now, and go to the nearest hospital if very unwell", () => {
    const d = describeNotification({ template: "free_tier_reading_self_care_suggestion", payload: priority } as Input);
    expect(d.text).toMatch(/get care now/i);
    expect(d.text).toMatch(/nearest hospital/i);
  });

  it("is the same line for every level, because the preview never reads level_label, the reading or the note (INV-07)", () => {
    const lines = [priority, review, prompt, {}].map(
      (payload) => describeNotification({ template: "free_tier_reading_self_care_suggestion", payload } as Input).text,
    );
    expect(new Set(lines).size).toBe(1);
    expect(lines[0]).not.toMatch(/blood pressure|oxygen|Priority|Review needed|rest for 5 minutes|reading/i);
  });

  it("is plain written English: no dash, no old generic wording", () => {
    const d = describeNotification({ template: "free_tier_reading_self_care_suggestion", payload: priority } as Input);
    expect(d.text).not.toMatch(/[—–]/);
    expect(d.text).not.toMatch(/Something needs your attention/);
    expect(d.href).toBe("/patient/subscription");
  });
});

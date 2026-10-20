import { activityGate, type ActivityGateInput, type ActivitySafetyConfig } from "@tarragon/clinical/activity-gate";
import { getProposedConfig } from "@tarragon/shared";
import { pickerLabel } from "./not-suggested";

const config = getProposedConfig("activity.safety_rules").value as unknown as ActivitySafetyConfig;
const NOW = "2026-10-20T12:00:00Z";
const base: ActivityGateInput = { now: NOW, events: [], conditions: [], pregnancy: null };
const pregnant = activityGate({ ...base, pregnancy: { isPregnant: true, highRisk: true } }, config);
const amber = activityGate({ ...base, events: [{ grade: "amber", at: "2026-10-20T10:00:00Z", triggerType: "observation" }] }, config);
const rest = activityGate({ ...base, events: [{ grade: "red", at: "2026-10-20T10:00:00Z", triggerType: "observation" }] }, config);
const open = activityGate(base, config);

describe("pickerLabel", () => {
  it("marks a blocked kind as not suggested, without hiding it", () => {
    expect(pickerLabel("Football", pregnant, config)).toBe("Football (not suggested right now)");
    expect(pickerLabel("Run", pregnant, config)).toBe("Run (not suggested right now)");
    expect(pickerLabel("Indoor Walk", pregnant, config)).toBe("Indoor Walk");
  });

  it("marks a kind above the allowed level when only gentle activity is suggested", () => {
    expect(pickerLabel("Cycling", amber, config)).toBe("Cycling (not suggested right now)");
    expect(pickerLabel("Chair-based exercise", amber, config)).toBe("Chair-based exercise");
  });

  it("marks nothing when the gate says all clear, says rest, or is not known yet", () => {
    expect(pickerLabel("Football", open, config)).toBe("Football");
    expect(pickerLabel("Football", rest, config)).toBe("Football");
    expect(pickerLabel("Football", null, config)).toBe("Football");
    expect(pickerLabel("Football", pregnant, null)).toBe("Football");
  });

  it("leaves a name with no kind alone", () => {
    expect(pickerLabel("Yoga", pregnant, config)).toBe("Yoga");
  });
});

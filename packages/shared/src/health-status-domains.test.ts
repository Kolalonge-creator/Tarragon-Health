import { describe, expect, it } from "@jest/globals";
import { buildHealthStatusDomains, healthStatusSummary, healthStatusWord, trendWords, HEALTH_STATUS_DISCLAIMER } from "./health-status-domains";

const lab = (code: string, latest: number, opts: Partial<Record<string, unknown>> = {}) => ({
  code, latest_value: latest, latest_unit: "%", latest_at: "2026-10-01T09:00:00Z", ref_low: null, ref_high: null, ref_text: null, flag: null,
  previous_value: null, previous_unit: null, previous_at: null, disputed: false, ...opts,
});

describe("buildHealthStatusDomains (T2-06: per-domain status, no composite score)", () => {
  it("shows only the domains that have something behind them, in a fixed order", () => {
    const d = buildHealthStatusDomains({ labs: [lab("haemoglobin", 13, { latest_unit: "g/dL" }), lab("hba1c", 6.1)] });
    expect(d.map((x) => x.key)).toEqual(["metabolic", "haematological"]);
    expect(buildHealthStatusDomains({})).toEqual([]);
    expect(healthStatusSummary([])).toBeNull();
  });

  it("gives every indicator its value, unit, date, printed range, flag and direction", () => {
    const [m] = buildHealthStatusDomains({
      labs: [lab("hba1c", 7.3, { ref_low: 4, ref_high: 5.6, previous_value: 6.7, previous_unit: "%", previous_at: "2026-07-01T09:00:00Z" })],
    });
    const i = m!.indicators[0]!;
    expect(i).toMatchObject({ label: "HbA1c", value: "7.3", unit: "%", at: "2026-10-01T09:00:00Z", rangeText: "4 to 5.6 %", flag: "above", trend: "up", previousValue: "6.7" });
    expect(m!.status).toBe("worth_discussing");
    expect(m!.actions[0]).toMatch(/care team/);
    expect(trendWords(i)).toBe("Up from 6.7 on 2026-07-01");
  });

  it("never compares across units, never flags without a range, and leaves a disputed value out", () => {
    const [m] = buildHealthStatusDomains({
      labs: [lab("fasting_glucose", 100, { latest_unit: "mg/dL", previous_value: 5.5, previous_unit: "mmol/L" }), lab("hba1c", 6.0, { disputed: true })],
    });
    expect(m!.indicators).toHaveLength(1);
    expect(m!.indicators[0]).toMatchObject({ trend: "first", previousValue: null, flag: "no_range", rangeText: null });
    expect(m!.status).toBe("not_enough_yet");
  });

  it("judges blood pressure against the person's own target and BMI against the configured line", () => {
    const [cardio, life] = buildHealthStatusDomains({
      vitals: {
        blood_pressure: [{ systolic: 142, diastolic: 88, taken_at: "2026-10-02T07:00:00Z" }, { systolic: 150, diastolic: 92, taken_at: "2026-09-02T07:00:00Z" }],
        bp_target: { systolic: 140, diastolic: 90, source: "default" },
        weight: [{ kg: 80, taken_at: "2026-10-02T07:00:00Z" }],
        height_cm: 170,
      },
    });
    expect(cardio!.indicators[0]).toMatchObject({ value: "142/88", flag: "above", trend: "down", previousValue: "150/92", rangeText: "your target is below 140/90 mmHg" });
    expect(cardio!.actions.join(" ")).toMatch(/Keep logging your blood pressure/);
    expect(life!.indicators.map((i) => i.key)).toEqual(["weight", "bmi"]);
    expect(life!.indicators[1]).toMatchObject({ value: "27.7", flag: "above" });
  });

  it("turns the screening schedule into outstanding actions, and an overdue one into worth discussing", () => {
    const [s] = buildHealthStatusDomains(
      { screening: { open: [{ name: "Cervical screening", status: "overdue", due_date: "2026-09-01" }, { name: "Eye check", status: "pending", due_date: "2027-01-10" }], completed_last_year: 1 } },
      new Date("2026-11-04T12:00:00Z"),
    );
    expect(s!.key).toBe("screening");
    expect(s!.status).toBe("worth_discussing");
    expect(healthStatusWord(s!)).toBe("Something is due");
    expect(healthStatusWord({ key: "screening", status: "within_range" })).toBe("Up to date");
    expect(healthStatusWord({ key: "renal", status: "within_range" })).toBe("Within range");
    expect(s!.actions).toEqual(["1 check done in the last 12 months", "Cervical screening: now due", "Eye check: due 2027-01-10"]);
  });

  it("carries no number score and no fear words anywhere", () => {
    const d = buildHealthStatusDomains({ labs: [lab("potassium", 6.2, { latest_unit: "mmol/L", ref_low: 3.5, ref_high: 5.1 })] });
    const text = JSON.stringify(d) + healthStatusSummary(d) + HEALTH_STATUS_DISCLAIMER;
    expect(text).not.toMatch(/\/100|score|warning|danger|urgent|critical/i);
    expect(HEALTH_STATUS_DISCLAIMER).toMatch(/does not replace a doctor's assessment/);
    expect(healthStatusSummary(d)).toBe("1 area of your health tracked. 1 worth discussing with your care team.");
  });
});

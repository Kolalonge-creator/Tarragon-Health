import { describe, expect, it } from "@jest/globals";
import { isShownCell, parseFairness, parseWorklist, reasonLabel, REASON_LABEL } from "./worklist";

const id = "11111111-1111-4111-8111-111111111111";
const row = {
  patient_id: id, patient_number: "TH-0001", level: "high", computed_level: "low", overridden: true, deterioration_risk: 85, dropout_risk: 0,
  reasons: [{ key: "bp_well_above_target", family: "deterioration", points: 45 }], computed_on: "2026-10-06", model_version: 1,
};

describe("risk worklist parsing", () => {
  it("accepts a well-formed worklist", () => {
    const r = parseWorklist({ rows: [row], note: "x" });
    expect(r?.rows[0]?.overridden).toBe(true);
  });
  it("rejects a malformed one instead of half-rendering it", () => {
    expect(parseWorklist({ rows: [{ ...row, level: "critical" }], note: "x" })).toBeNull();
    expect(parseWorklist("nope")).toBeNull();
  });
  it("has a plain-English label for every reason key the database can emit", () => {
    const emitted = ["bp_well_above_target", "bp_above_target", "bp_rising", "recent_red_event", "recent_amber_event", "last_snapshot_uncontrolled",
      "low_adherence", "no_readings_ever", "silent_long", "silent_some", "fewer_readings"];
    for (const k of emitted) expect(REASON_LABEL[k]).toBeTruthy();
    expect(reasonLabel("something_new")).toBe("something_new");
  });
  it("labels never use fear wording or em dashes", () => {
    for (const v of Object.values(REASON_LABEL)) expect(v).not.toMatch(/—|warning|danger|critical/i);
  });
});

describe("fairness parsing", () => {
  const f = {
    total_scored: 11, minimum_cell: 2, purpose: "p",
    by: { sex: [], age_band: [], state: [{ key: "Lagos", n: 6, high: 2, medium: 2, low: 2, high_pct: 33.3 }, { key: "Oyo", suppressed: true }] },
  };
  it("distinguishes shown groups from withheld ones", () => {
    const r = parseFairness(f);
    expect(r?.by.state.map(isShownCell)).toEqual([true, false]);
  });
  it("rejects a malformed report", () => {
    expect(parseFairness({ ...f, by: {} })).toBeNull();
  });
});

/**
 * S07y: the trend chart's points keep the reading's label. A reading taken at a pharmacy or clinic machine, or copied from a paper diary, must reach the chart
 * as such: if the mapping from a stored reading to a plotted point drops `entry_origin`, the chart's note ("N points were taken at a pharmacy or clinic
 * machine") has nothing to count and those points look like ordinary home readings. (Found by the code review: a component test that fed the chart rows with
 * the label passed while the real query dropped it.)
 */
jest.mock("@/lib/supabase/client", () => ({ createClient: jest.fn() }));
jest.mock("@/lib/clinical/vitals-audited", () => ({ readPatientVitalsOrThrow: jest.fn() }));
jest.mock("@/lib/obesity/classify", () => ({ computeBmi: jest.fn() }));
jest.mock("@/lib/health-metrics/height", () => ({ fetchHeightStatus: jest.fn() }));

import { toTrendPoint } from "./vitals";

const row = {
  taken_at: "2026-10-18T07:30:00Z",
  systolic: 132,
  diastolic: 84,
  glucose_mmol_l: null,
  glucose_context: null,
  weight_kg: null,
  pulse_bpm: null,
  assisted_entry: false,
  assisted_rate_exceeded: false,
};

describe("toTrendPoint", () => {
  it("carries the label of a pharmacy or diary reading", () => {
    expect(toTrendPoint({ ...row, entry_origin: "pharmacy_machine" }).entry_origin).toBe("pharmacy_machine");
    expect(toTrendPoint({ ...row, entry_origin: "paper_diary" }).entry_origin).toBe("paper_diary");
  });
  it("an ordinary reading has none", () => {
    expect(toTrendPoint({ ...row, entry_origin: null }).entry_origin).toBeNull();
  });
  it("carries the assisted-entry flags", () => {
    expect(toTrendPoint({ ...row, entry_origin: null, assisted_entry: true, assisted_rate_exceeded: true })).toMatchObject({ assisted: true, assistedOverLimit: true });
  });
  it("keeps what the chart plots", () => {
    expect(toTrendPoint({ ...row, entry_origin: null })).toMatchObject({ taken_at: row.taken_at, systolic: 132, diastolic: 84 });
  });
});

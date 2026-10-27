jest.mock("server-only", () => ({}));
import { cascadeRulesView, readPendingCascadeConfigSignoff } from "./pending-cascade-config-signoff";

const cond = (controlled: Record<string, unknown>) => ({
  ...controlled,
  stages: [{ code: "enrolled", label: "Enrolled", definition: "Adults." }],
  not_available: [{ item: "Prevalence", reason: "Not a population." }],
});
const config = {
  hypertension: cond({ controlled_below: { systolic: 140, diastolic: 90 }, control_window_days: 7, min_readings: 3 }),
  diabetes: cond({ controlled_hba1c_below_percent: 7, lookback_days: 180 }),
  selection_panel: { note: "These comparisons are descriptive, not causal." },
  notes: { difference_from_s38: "The two measures can differ." },
};

describe("cascadeRulesView", () => {
  it("shows the control lines exactly as the draft states them", () => {
    const v = cascadeRulesView(config);
    expect(v?.hypertension.controlled).toBe("the average of the cleared home readings in the last 7 days up to the report day, from at least 3 readings, is under 140/90");
    expect(v?.diabetes.controlled).toBe("the most recent HbA1c in the last 180 days is under 7 percent");
    expect(v?.hypertension.notAvailable[0]).toMatch(/^Prevalence/);
  });
  it("returns null when something it must show is missing", () => {
    expect(cascadeRulesView({ ...config, hypertension: undefined })).toBeNull();
    expect(cascadeRulesView(null)).toBeNull();
  });
});

function client(res: { data: unknown; error: unknown } | "throw") {
  return {
    from: () => ({
      select: () => {
        if (res === "throw") throw new Error("boom");
        return Promise.resolve(res);
      },
    }),
  } as never;
}

describe("readPendingCascadeConfigSignoff", () => {
  it("reports the newest unsigned draft newer than the live one", async () => {
    const rows = [{ version: 1, is_active: false, approved_at: null, config }];
    expect(await readPendingCascadeConfigSignoff(client({ data: rows, error: null }))).toMatchObject({ version: 1, failed: false });
  });
  it("reports nothing waiting once signed", async () => {
    const rows = [{ version: 1, is_active: true, approved_at: "2026-10-23", config }];
    expect(await readPendingCascadeConfigSignoff(client({ data: rows, error: null }))).toMatchObject({ version: null, failed: false });
  });
  it("never shows a failed read as an all-clear", async () => {
    expect((await readPendingCascadeConfigSignoff(client({ data: null, error: { message: "x" } }))).failed).toBe(true);
    expect((await readPendingCascadeConfigSignoff(client("throw"))).failed).toBe(true);
  });
});

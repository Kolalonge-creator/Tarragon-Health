jest.mock("server-only", () => ({}));
import { getProposedConfig } from "@tarragon/shared";
import { careGapRulesView, readPendingCareGapConfigSignoff } from "./pending-care-gap-config-signoff";

const config = getProposedConfig("care_gaps.rules").value as Record<string, unknown>;

describe("careGapRulesView", () => {
  it("shows every rule with the lines the draft carries", () => {
    const v = careGapRulesView(config);
    expect(v?.rules.map((r) => r.code)).toEqual(["missed_reading", "no_hba1c_12_months", "no_lipids_12_months", "rising_bp_trend", "medication_refill_lapse", "adherence_lapse"]);
    expect(v?.rules[0]?.lines).toContain("Hypertension: no home blood pressure reading in 14 days");
    expect(v?.rules[1]?.lines).toEqual(expect.arrayContaining(["No matching lab result in the last 365 days", "Counted overdue 30 days after it falls due"]));
    expect(v?.rules[5]?.lines).toContain("Reads the existing adherence.below_line signal");
  });

  it("says plainly which numbers the CMO still has to supply, so the rule is not signed unseen as if it worked", () => {
    const v = careGapRulesView(config);
    expect(v?.rules[0]?.notSupplied).toEqual(["diabetes_days_without_reading"]);
    expect(v?.rules[3]?.notSupplied).toEqual(["min_rise_systolic_mmhg"]);
    expect(v?.rules[1]?.notSupplied).toEqual([]);
  });

  it("routes the trend to a doctor and the rest to a coordinator", () => {
    const v = careGapRulesView(config);
    expect(v?.rules.filter((r) => r.owner === "doctor").map((r) => r.code)).toEqual(["rising_bp_trend"]);
  });

  it("states the ladder, the cap, the quiet hours and that no experiment is on", () => {
    const v = careGapRulesView(config);
    expect(v?.ladder).toEqual(
      expect.arrayContaining([
        "Steps in order: push, then in app, then email, then coordinator call",
        "At most 2 messages a week to one patient, across all gaps",
        "No message between 20:00 and 08:00 Lagos time",
      ]),
    );
    expect(v?.experiments).toMatch(/No experiment is switched on/);
    expect(v?.verifyAgainstSource).toBe(true);
  });

  it("returns null when something it must show is missing", () => {
    expect(careGapRulesView(null)).toBeNull();
    expect(careGapRulesView({ ...config, ladder: undefined })).toBeNull();
    const broken = JSON.parse(JSON.stringify(config)) as { rules: Record<string, unknown> };
    delete broken.rules.missed_reading;
    expect(careGapRulesView(broken)).toBeNull();
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

describe("readPendingCareGapConfigSignoff", () => {
  it("reports the newest unsigned draft newer than the live one", async () => {
    const rows = [{ version: 1, is_active: false, approved_at: null, config }];
    expect(await readPendingCareGapConfigSignoff(client({ data: rows, error: null }))).toMatchObject({ version: 1, failed: false });
  });
  it("reports nothing waiting once signed", async () => {
    const rows = [{ version: 1, is_active: true, approved_at: "2026-10-27", config }];
    expect(await readPendingCareGapConfigSignoff(client({ data: rows, error: null }))).toMatchObject({ version: null, failed: false });
  });
  it("never shows a failed read as an all-clear", async () => {
    expect((await readPendingCareGapConfigSignoff(client({ data: null, error: { message: "x" } }))).failed).toBe(true);
    expect((await readPendingCareGapConfigSignoff(client("throw"))).failed).toBe(true);
  });
});

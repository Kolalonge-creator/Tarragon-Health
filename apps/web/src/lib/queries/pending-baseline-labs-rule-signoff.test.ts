jest.mock("server-only", () => ({}));
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { baselineLabsRuleView, readPendingBaselineLabsRuleSignoff } from "./pending-baseline-labs-rule-signoff";

/** The real v1 seed, so the panel is proven against what the CMO will actually be shown. */
function seed(): unknown {
  const dir = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations");
  const file = readdirSync(dir).find((f) => f.endsWith("_baseline_labs_prescribing_rule.sql"));
  if (!file) throw new Error("migration not found");
  const m = /baseline-labs-rule-v1-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(dir, file), "utf8"));
  if (!m?.[1]) throw new Error("seed not found");
  return JSON.parse(m[1]);
}

describe("baselineLabsRuleView", () => {
  it("shows the medicines, labs, window and refusal exactly as the draft states them", () => {
    const v = baselineLabsRuleView(seed());
    expect(v?.windowDays).toBe(90);
    expect(v?.requiredForAll).toEqual(["Kidney function (creatinine or eGFR)", "Potassium", "Glucose"]);
    expect(v?.requiredIfDiabetes).toEqual(["HbA1c"]);
    expect(v?.groups.map((g) => g.label)).toEqual(["Blood-pressure-lowering medicines", "Glucose-lowering medicines"]);
    expect(v?.groups[0]?.medicines).toContain("losartan");
    expect(v?.groups[1]?.medicines).toContain("metformin");
    expect(v?.groups.every((g) => g.medicines.every((m) => !m.includes("%")))).toBe(true);
    expect(v?.bypassNote).toMatch(/no bypass/i);
    expect(v?.proposedNote).toMatch(/PROPOSED/);
  });
  it("returns null when something it must show is missing", () => {
    expect(baselineLabsRuleView(null)).toBeNull();
    const s = seed() as Record<string, unknown>;
    expect(baselineLabsRuleView({ ...s, recency_window_days: undefined })).toBeNull();
    expect(baselineLabsRuleView({ ...s, required_baseline: undefined })).toBeNull();
  });
  it("refuses a draft that offers a bypass, since v1 has none to show", () => {
    const s = seed() as { when_labs_are_missing: Record<string, unknown> };
    expect(baselineLabsRuleView({ ...s, when_labs_are_missing: { ...s.when_labs_are_missing, bypass_available: true } })).toBeNull();
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

describe("readPendingBaselineLabsRuleSignoff", () => {
  it("reports the newest unsigned draft newer than the live one", async () => {
    const rows = [{ version: 1, is_active: false, approved_at: null, config: seed() }];
    expect(await readPendingBaselineLabsRuleSignoff(client({ data: rows, error: null }))).toMatchObject({ version: 1, failed: false });
  });
  it("reports nothing waiting once signed", async () => {
    const rows = [{ version: 1, is_active: true, approved_at: "2026-10-26", config: seed() }];
    expect(await readPendingBaselineLabsRuleSignoff(client({ data: rows, error: null }))).toMatchObject({ version: null, failed: false });
  });
  it("never shows a failed read as an all-clear", async () => {
    expect((await readPendingBaselineLabsRuleSignoff(client({ data: null, error: { message: "x" } }))).failed).toBe(true);
    expect((await readPendingBaselineLabsRuleSignoff(client("throw"))).failed).toBe(true);
  });
});

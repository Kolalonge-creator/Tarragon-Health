/**
 * CMO decision Q4 (2026-10-07): a wrist cuff reading is graded normally, the repeat prompt gains "repeat with an upper-arm cuff if you have one",
 * and a red is NEVER downgraded for the cuff type. The advice is words only: it never reaches the engine.
 */
import { t } from "@tarragon/i18n";
import { activeGlucoseWording } from "@tarragon/i18n";
import { gradeOnDevice, wantsUpperArmAdvice } from "./triage-device";
import { grade, BP_CARE_V1, type TriageInput } from "@tarragon/clinical";

jest.mock("./supabase", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) }, rpc: async () => ({ data: null, error: null }) },
}));

const NOW = Date.parse("2026-10-13T09:00:00.000Z");
const CUFFS = ["upper_arm", "wrist", "not_sure", null] as const;

describe("Q4: upper-arm advice beside a repeat prompt", () => {
  it.each(CUFFS)("a first 182/112 asks for a repeat; advice is shown only for wrist or not sure (cuff: %s)", async (cuff) => {
    const triage = await gradeOnDevice({ subjectId: "", systolic: 182, diastolic: 112, symptoms: [], cuffType: cuff, nowMs: NOW });
    expect(triage.result.status).toBe("recheck_required");
    expect(triage.cuffAdvice !== null).toBe(cuff === "wrist" || cuff === "not_sure");
    if (triage.cuffAdvice) expect(triage.cuffAdvice).toEqual({ title: "triage.cuf_001.title", body: "triage.cuf_001.body" });
  });

  it("the advice says upper arm and 'if you have one', and is flagged unsigned (the plain text is in force until the CMO signs)", () => {
    expect(t("triage.cuf_001.body", "en")).toMatch(/upper arm cuff/i);
    expect(t("triage.cuf_001.body", "en")).toMatch(/if you have/i);
    expect(activeGlucoseWording("CUF-001").body).toBe(t("triage.cuf_001.body", "en"));
  });

  it("never downgrades a red for the cuff type: the same grade, rule and guidance for every cuff", async () => {
    const results = await Promise.all(
      CUFFS.map((cuff) => gradeOnDevice({ subjectId: "", systolic: 185, diastolic: 125, symptoms: ["severe_headache"], cuffType: cuff, nowMs: NOW })),
    );
    for (const r of results) {
      expect(r.result).toEqual(results[0]?.result);
      expect(r.result).toMatchObject({ grade: "red", ruleId: "BP-R1" });
      expect(r.severity).toBe("emergency");
      expect(r.cuffAdvice).toBeNull();
    }
  });

  it("the engine never sees the cuff type: grading is identical with and without it, for a spread of readings", async () => {
    for (const [s, d] of [[118, 76], [150, 95], [182, 112], [205, 100], [88, 60], [160, 110]] as const) {
      const a = await gradeOnDevice({ subjectId: "", systolic: s, diastolic: d, symptoms: [], cuffType: "wrist", nowMs: NOW });
      const b = await gradeOnDevice({ subjectId: "", systolic: s, diastolic: d, symptoms: [], cuffType: "upper_arm", nowMs: NOW });
      expect(a.result).toEqual(b.result);
      expect(a.severity).toBe(b.severity);
    }
  });

  it("a result that asks for no repeat carries no advice, whatever the cuff", async () => {
    const triage = await gradeOnDevice({ subjectId: "", systolic: 118, diastolic: 76, symptoms: [], cuffType: "wrist", nowMs: NOW });
    expect(triage.cuffAdvice).toBeNull();
  });

  it("wantsUpperArmAdvice is true for a prompt_recheck beside an amber as well as for a repeat-required result", () => {
    const input: TriageInput = {
      trigger: { type: "observation", reading: { systolic: 150, diastolic: 95, takenAt: "2026-10-13T09:00:00.000Z" }, symptoms: [] },
      history: [], target: { systolic: 135, diastolic: 85 }, pathway: { state: "self_guided" }, pregnant: false, ageYears: 45, now: "2026-10-13T09:00:00.000Z",
    };
    const result = grade(input, BP_CARE_V1);
    expect(wantsUpperArmAdvice(result, "wrist")).toBe(result.actions.some((a) => a.kind === "prompt_recheck") || result.status === "recheck_required");
    expect(wantsUpperArmAdvice({ ...result, status: "recheck_required" }, "wrist")).toBe(true);
    expect(wantsUpperArmAdvice({ ...result, status: "recheck_required" }, "upper_arm")).toBe(false);
    expect(wantsUpperArmAdvice({ ...result, status: "recheck_required" }, null)).toBe(false);
    expect(wantsUpperArmAdvice({ ...result, status: "graded", actions: [{ kind: "prompt_recheck", code: "TRI-005" }] }, "not_sure")).toBe(true);
  });
});

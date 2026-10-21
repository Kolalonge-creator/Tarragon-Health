import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { BP_CARE_V1, BP_CARE_V6, BP_CARE_V7, SYMPTOM_ALONE_EMERGENCY, grade, summarise, validateInput, validateRuleSet, type SymptomCode, type TriageInput } from "./index";
import { adherencePercentOf, buildContext } from "./context";

// Follow-up OQ-355: bp_care_triage v7 is a DRAFT that grades a symptom reported with no reading. OQ-356: the adherence field is percentWindow.
const NOW = "2026-10-05T09:00:00Z";
const sym = (symptoms: SymptomCode[], over: Partial<TriageInput> = {}): TriageInput => ({
  trigger: { type: "symptom", symptoms },
  history: [],
  target: { systolic: 135, diastolic: 85 },
  pathway: { state: "self_guided" },
  pregnant: false,
  ageYears: 45,
  now: NOW,
  ...over,
});
const s7 = (i: TriageInput) => summarise(grade(i, BP_CARE_V7));

describe("bp_care_triage v7 (a symptom with no reading)", () => {
  it("is valid, still a draft, same code, built on v6", () => {
    expect(validateRuleSet(BP_CARE_V7)).toEqual([]);
    expect(BP_CARE_V7.code).toBe("bp_care_triage");
    expect(BP_CARE_V7.status).toBe("draft");
    expect(BP_CARE_V7.version).toBe(7);
  });

  it("differs from v6 only in the version, the new group, the note and the three symptom rules", () => {
    const strip = (r: typeof BP_CARE_V7) => {
      const j = JSON.parse(JSON.stringify(r)) as { version?: number; params: Record<string, unknown> & { symptomGroups: Record<string, unknown> }; rules: { id: string }[] };
      delete j.version;
      delete j.params.proposedForCmo;
      delete j.params.symptomGroups.symptomAloneEmergency;
      j.rules = j.rules.filter((x) => !["BP-S1", "BP-S2", "BP-S3"].includes(x.id));
      return j;
    };
    expect(strip(BP_CARE_V7)).toEqual(strip(BP_CARE_V6));
    expect(BP_CARE_V7.rules.filter((r) => r.triggers.includes("symptom")).map((r) => r.id).sort()).toEqual(["BP-S1", "BP-S2", "BP-S3"]);
    expect(BP_CARE_V7.params.symptomGroups.symptomAloneEmergency).toEqual([...SYMPTOM_ALONE_EMERGENCY]);
    expect(Object.keys(BP_CARE_V7.params.proposedForCmo as object)).toContain("symptomAlone");
    expect(JSON.stringify(BP_CARE_V7)).not.toMatch(/not signed|unsigned|has not signed/i);
  });

  it.each(["chest_pain", "weakness_or_numbness", "difficulty_speaking"] as SymptomCode[])("%s alone is RED, shows emergency guidance and pages", (s) => {
    expect(s7(sym([s]))).toMatchObject({ status: "graded", grade: "red", ruleId: "BP-S1", actions: ["show_emergency_guidance:EMG-001", "page_on_call"] });
  });

  it.each(["severe_headache", "breathlessness", "back_pain", "confusion", "visual_disturbance"] as SymptomCode[])("%s alone is AMBER with the urgent review task", (s) => {
    const r = grade(sym([s]), BP_CARE_V7);
    expect(r).toMatchObject({ status: "graded", grade: "amber", ruleId: "BP-S2", taskKey: "BP-S2:2026-W41" });
    expect(r.actions.map((a) => a.kind)).toEqual(["show_emergency_guidance", "create_task"]);
  });

  it("a red symptom beside an amber one is red (the first red wins)", () => {
    expect(s7(sym(["severe_headache", "chest_pain"]))).toMatchObject({ grade: "red", ruleId: "BP-S1" });
  });

  it("a convulsion or loss of consciousness is red only in pregnancy or after a birth", () => {
    expect(s7(sym(["convulsion"], { pregnant: true }))).toMatchObject({ grade: "red", ruleId: "BP-S3" });
    expect(s7(sym(["loss_of_consciousness"], { postpartum: true }))).toMatchObject({ grade: "red", ruleId: "BP-S3" });
    expect(s7(sym(["convulsion"]))).toMatchObject({ grade: "green", ruleId: null });
  });

  it("a symptom that is on no list is green (no rule), and is graded by no earlier version at all", () => {
    expect(s7(sym(["dizziness"]))).toMatchObject({ grade: "green", ruleId: null });
    expect(summarise(grade(sym(["chest_pain"]), BP_CARE_V6))).toMatchObject({ grade: "green", ruleId: null });
  });

  it("suppresses a second task in the same week", () => {
    expect(grade(sym(["back_pain"], { existingOpenTaskKeys: ["BP-S2:2026-W41"] }), BP_CARE_V7)).toMatchObject({ duplicateSuppressed: true });
  });

  it("symptom rules never fire for a reading, and reading rules never fire for a symptom", () => {
    const reading: TriageInput = { ...sym([]), trigger: { type: "observation", reading: { systolic: 120, diastolic: 78, takenAt: NOW }, symptoms: ["chest_pain"] } };
    expect(grade(reading, BP_CARE_V7).matchedRuleIds.some((id) => id.startsWith("BP-S"))).toBe(false);
    expect(grade(sym(["chest_pain"]), BP_CARE_V7).matchedRuleIds).toEqual(["BP-S1", "BP-S2"]);
  });

  it("rejects a symptom trigger with no, or a malformed, symptom list", () => {
    for (const bad of [[], "chest_pain", [1]]) {
      expect(validateInput({ ...sym([]), trigger: { type: "symptom", symptoms: bad as never } }, BP_CARE_V7)).toBe("invalid_input");
    }
    expect(validateInput(sym(["chest_pain"]), BP_CARE_V7)).toBeNull();
  });

  it("a rejected symptom report with a red flag still shows the guidance", () => {
    const r = grade({ ...sym(["chest_pain"]), now: "not a date" }, BP_CARE_V7);
    expect(r.status).toBe("rejected");
  });

  it("is what the server derives from the stored v6 row, and signs nothing", () => {
    const dir = new URL("../../../supabase/migrations/", import.meta.url);
    const file = readdirSync(dir).find((f) => f.endsWith("_fu_bp_care_triage_v7_symptom_alone_draft.sql"));
    expect(file).toBeDefined();
    const mig = readFileSync(new URL(file!, dir), "utf8");
    expect(mig).toContain("where code = 'bp_care_triage' and version = 6");
    expect(mig).toContain("'draft'");
    for (const id of ["BP-S1", "BP-S2", "BP-S3"]) expect(mig).toContain(id);
    for (const s of SYMPTOM_ALONE_EMERGENCY) expect(mig).toContain(`"${s}"`);
    expect(mig).not.toMatch(/approve_triage_rule_set\s*\(/);
    expect(mig).not.toMatch(/status\s*=\s*'approved'/);
    // the SQL carries the very same three rules as the code (compared as parsed JSON, so spacing does not matter)
    const m = /\$json\$([\s\S]*?)\$json\$/.exec(mig);
    expect(m?.[1]).toBeDefined();
    expect(JSON.parse(m![1]!)).toEqual(JSON.parse(JSON.stringify(BP_CARE_V7.rules.filter((r) => r.triggers.includes("symptom")))));
  });
});

describe("adherence field rename (OQ-356)", () => {
  const adh = (trigger: unknown): TriageInput => ({ ...sym([]), trigger: trigger as never, pathway: { state: "care_pack_active" } });
  it("reads percentWindow, falls back to the deprecated percent7d, else null", () => {
    expect(adherencePercentOf({ type: "adherence", percentWindow: 61 })).toBe(61);
    expect(adherencePercentOf({ type: "adherence", percentWindow: null })).toBeNull();
    expect(adherencePercentOf({ type: "adherence", percent7d: 40 } as never)).toBe(40);
  });
  it("percentWindow wins over percent7d when both are given, even a zero or a null", () => {
    expect(adherencePercentOf({ type: "adherence", percentWindow: 61, percent7d: 40 })).toBe(61);
    expect(adherencePercentOf({ type: "adherence", percentWindow: 0, percent7d: 40 })).toBe(0);
    expect(adherencePercentOf({ type: "adherence", percentWindow: null, percent7d: 40 })).toBeNull();
  });
  it("an older caller that only sends percent7d still grades, and the legacy rule field keeps working", () => {
    const legacy = adh({ type: "adherence", percent7d: 50 });
    expect(adherencePercentOf(legacy.trigger)).toBe(50);
    expect(validateInput(legacy, BP_CARE_V1)).toBeNull();
    expect(summarise(grade(legacy, BP_CARE_V1))).toMatchObject({ grade: "amber", ruleId: "BP-A4" });
    const ctx = buildContext(legacy, BP_CARE_V1);
    expect(ctx["adherence.percentWindow"]).toBe(50);
    expect(ctx["adherence.percent7d"]).toBe(50);
  });
  it("a trigger with neither field, or a non-adherence trigger, has no percentage and is invalid", () => {
    expect(adherencePercentOf({ type: "symptom", symptoms: ["chest_pain"] })).toBeNull();
    expect(adherencePercentOf({ type: "adherence" } as never)).toBeNull();
    expect(validateInput(adh({ type: "adherence" }), BP_CARE_V1)).toBe("invalid_input");
    expect(validateInput(adh({ type: "adherence", percentWindow: "7" }), BP_CARE_V1)).toBe("invalid_input");
  });
  it("a rule set may use the new field name", () => {
    const rs = JSON.parse(JSON.stringify(BP_CARE_V1)) as typeof BP_CARE_V1;
    const a4 = (rs.rules as unknown as { id: string; when: { all: { field?: string }[] } }[]).find((r) => r.id === "BP-A4")!;
    for (const c of a4.when.all) if (c.field === "adherence.percent7d") c.field = "adherence.percentWindow";
    expect(validateRuleSet(rs)).toEqual([]);
    expect(summarise(grade(adh({ type: "adherence", percentWindow: 50 }), rs))).toMatchObject({ ruleId: "BP-A4" });
  });
});

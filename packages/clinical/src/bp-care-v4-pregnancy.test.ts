import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { BP_CARE_V3, BP_CARE_V4, grade, validateRuleSet, type SymptomCode, type TriageInput, type TriageResult } from "./index";

/**
 * S67 (16.6) acceptance tests for the pregnancy blood pressure rules. Rule set version 4 is a DRAFT: nothing here signs or approves
 * it. The CMO's selections A1 and A2 (docs/plans/S66-S70-cmo-signoff-pack.md) are the numbers under test.
 */
const NOW = "2026-10-07T09:00:00Z";
const run = (
  systolic: number,
  diastolic: number,
  opts: { pregnant?: boolean; postpartum?: boolean; symptoms?: SymptomCode[] } = {},
  ruleSet = BP_CARE_V4,
): TriageResult => {
  const input: TriageInput = {
    trigger: { type: "observation", reading: { systolic, diastolic, takenAt: NOW }, symptoms: opts.symptoms ?? [], symptomsAnswered: true },
    history: [],
    target: { systolic: 135, diastolic: 85 },
    pathway: { state: "self_guided" },
    pregnant: opts.pregnant ?? true,
    postpartum: opts.postpartum,
    ageYears: 28,
    now: NOW,
  };
  return grade(input, ruleSet);
};
const pages = (r: TriageResult) => r.actions.some((a) => a.kind === "page_on_call");
const guidance = (r: TriageResult) => r.actions.some((a) => a.kind === "show_emergency_guidance");

describe("rule set v4 (S67): v3 plus the pre-eclampsia swelling sign and BP-P6", () => {
  it("is a draft, valid, and the same code as v3", () => {
    expect(BP_CARE_V4.status).toBe("draft");
    expect(BP_CARE_V4.version).toBe(4);
    expect(BP_CARE_V4.code).toBe(BP_CARE_V3.code);
    expect(validateRuleSet(BP_CARE_V4)).toEqual([]);
  });

  it("differs from v3 only by the version, one symptom in preeclampsiaFlag, the new group and rule BP-P6", () => {
    const a = JSON.parse(JSON.stringify(BP_CARE_V3)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const b = JSON.parse(JSON.stringify(BP_CARE_V4)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(b.params.symptomGroups.preeclampsiaFlag).toEqual([...a.params.symptomGroups.preeclampsiaFlag, "sudden_face_hand_swelling"]);
    expect(b.params.symptomGroups.obstetricEmergency).toEqual(["convulsion", "loss_of_consciousness"]);
    expect(b.rules.map((r: { id: string }) => r.id).filter((id: string) => !a.rules.some((r: { id: string }) => r.id === id))).toEqual(["BP-P6"]);
    a.version = b.version = 0;
    delete a.params.symptomGroups.preeclampsiaFlag;
    delete b.params.symptomGroups.preeclampsiaFlag;
    delete b.params.symptomGroups.obstetricEmergency;
    b.rules = b.rules.filter((r: { id: string }) => r.id !== "BP-P6");
    expect(b).toEqual(a);
  });

  it("keeps the A1 numbers in the parameters: 160/110 severe, 140/90 raised", () => {
    expect(BP_CARE_V4.params.pregnancy).toEqual({ severeSystolic: 160, severeDiastolic: 110, raisedSystolic: 140, raisedDiastolic: 90 });
  });
});

describe("pregnancy blood pressure acceptance (spec 16.6, A1)", () => {
  it("BP 150/100 at 30 weeks with headache is RED, shows the emergency guidance and pages on-call (INV-05)", () => {
    // The engine takes no gestational week: the pregnant flag is what switches the rule set, so 30 weeks and 12 weeks are the same input.
    const r = run(150, 100, { symptoms: ["severe_headache"] });
    expect(r).toMatchObject({ status: "graded", grade: "red", ruleId: "BP-P4" });
    expect(guidance(r)).toBe(true);
    expect(pages(r)).toBe(true);
  });

  it.each([
    [139, 89, "amber", "BP-P1"],
    [140, 90, "amber", "BP-P1"],
    [159, 109, "amber", "BP-P1"],
    [160, 110, "red", "BP-P3"],
    [161, 90, "red", "BP-P3"],
    [120, 111, "red", "BP-P3"],
    [160, 70, "red", "BP-P3"],
  ] as const)("no symptom, pregnant, %i/%i is %s by %s", (s, d, g, rule) => {
    const r = run(s, d);
    expect(r).toMatchObject({ status: "graded", grade: g, ruleId: rule });
    expect(pages(r)).toBe(g === "red");
  });

  it.each([
    [139, 89, "amber"],
    [140, 90, "red"],
    [140, 80, "red"],
    [120, 90, "red"],
    [139, 90, "red"],
  ] as const)("with a pre-eclampsia symptom, %i/%i is %s (raised means either value at 140 or 90)", (s, d, g) => {
    expect(run(s, d, { symptoms: ["visual_disturbance"] }).grade).toBe(g);
  });

  it.each(["severe_headache", "visual_disturbance", "epigastric_pain", "breathlessness", "sudden_face_hand_swelling"] as const)(
    "140/90 with %s is red and pages",
    (sign) => {
      const r = run(140, 90, { symptoms: [sign] });
      expect(r).toMatchObject({ grade: "red", ruleId: "BP-P4" });
      expect(pages(r)).toBe(true);
    },
  );

  it("sudden swelling of the face or hands alone with a normal reading is not red (it is a pre-eclampsia sign only with a raised reading)", () => {
    const r = run(118, 76, { symptoms: ["sudden_face_hand_swelling"] });
    expect(r.grade).toBe("amber");
    expect(pages(r)).toBe(false);
  });

  it("the old v3 rule set does not know the swelling sign: 150/100 with it is amber there and red in v4", () => {
    expect(run(150, 100, { symptoms: ["sudden_face_hand_swelling"] }, BP_CARE_V3).grade).toBe("amber");
    expect(run(150, 100, { symptoms: ["sudden_face_hand_swelling"] }).grade).toBe("red");
  });

  it("the first 6 weeks after a birth use the same lines (obstetric)", () => {
    expect(run(150, 100, { pregnant: false, postpartum: true, symptoms: ["severe_headache"] })).toMatchObject({ grade: "red", ruleId: "BP-P4" });
    expect(run(165, 95, { pregnant: false, postpartum: true }).ruleId).toBe("BP-P3");
  });
});

describe("convulsion or loss of consciousness in pregnancy (A2, BP-P6)", () => {
  it.each(["convulsion", "loss_of_consciousness"] as const)("%s is RED with an ordinary reading, with guidance and an on-call page", (sign) => {
    const r = run(112, 70, { symptoms: [sign] });
    expect(r).toMatchObject({ status: "graded", grade: "red", ruleId: "BP-P6" });
    expect(guidance(r)).toBe(true);
    expect(pages(r)).toBe(true);
  });

  it("is red even with a low reading, and also after a birth", () => {
    expect(run(88, 54, { symptoms: ["convulsion"] }).grade).toBe("red");
    expect(run(112, 70, { pregnant: false, postpartum: true, symptoms: ["convulsion"] }).ruleId).toBe("BP-P6");
  });

  it("a reading too impossible to grade still shows the emergency guidance for a convulsion", () => {
    const r = run(500, 20, { symptoms: ["convulsion"] });
    expect(r.status).toBe("rejected");
    expect(r.redFlagSymptomPresent).toBe(true);
    expect(guidance(r)).toBe(true);
  });

  it("is not a pregnancy rule for someone who is not pregnant: BP-P6 does not match", () => {
    expect(run(112, 70, { pregnant: false, symptoms: ["convulsion"] }).matchedRuleIds).not.toContain("BP-P6");
  });
});

describe("the pregnant flag false falls back to the adult rules", () => {
  it("150/100 and 161/90 are advice only for an adult below the urgent line, not a pregnancy referral", () => {
    for (const [s, d] of [[150, 100], [161, 90], [139, 89]] as const) {
      const r = run(s, d, { pregnant: false });
      expect(r.matchedRuleIds).not.toContain("BP-P1");
      expect(r.matchedRuleIds).not.toContain("BP-P3");
      expect(r.grade).toBe("green");
    }
  });

  it("150/100 with a headache is the adult amber (BP-A6), not the pregnancy red", () => {
    const r = run(150, 100, { pregnant: false, symptoms: ["severe_headache"] });
    expect(r).toMatchObject({ grade: "amber", ruleId: "BP-A6" });
    expect(pages(r)).toBe(false);
  });

  it("160/110 is not red for an adult (the adult severe line is 180/120)", () => {
    expect(run(160, 110, { pregnant: false }).grade).not.toBe("red");
  });
});

describe("determinism and the device path", () => {
  it("gives the same result when the rule set arrives as JSON (the phone)", () => {
    const device = JSON.parse(JSON.stringify(BP_CARE_V4)) as typeof BP_CARE_V4;
    for (const [s, d, sym] of [[150, 100, ["severe_headache"]], [112, 70, ["convulsion"]], [139, 89, []]] as const) {
      expect(grade(JSON.parse(JSON.stringify({
        trigger: { type: "observation", reading: { systolic: s, diastolic: d, takenAt: NOW }, symptoms: sym, symptomsAnswered: true },
        history: [], target: { systolic: 135, diastolic: 85 }, pathway: { state: "self_guided" }, pregnant: true, ageYears: 28, now: NOW,
      })) as TriageInput, device)).toEqual(run(s, d, { symptoms: [...sym] }));
    }
  });
});

describe("server seed", () => {
  it("the v4 draft row in the S67 migration is identical to the bundled rule set", () => {
    const dir = new URL("../../../supabase/migrations/", import.meta.url);
    const file = readdirSync(dir).find((f) => f.endsWith("_s67_bp_rule_set_v4_and_maternal_guard.sql"))!;
    const sql = readFileSync(new URL(file, dir), "utf8");
    const seeded = JSON.parse(/\$rules_json\$([\s\S]*?)\$rules_json\$/.exec(sql)![1]!) as unknown;
    expect(seeded).toEqual(JSON.parse(JSON.stringify(BP_CARE_V4)));
    expect(sql).toContain("'draft'");
    expect(sql).not.toMatch(/approve_triage_rule_set\(/);
  });

  it("the migration that adds the guard writes no sign-off, attestation, log or approval", () => {
    const dir = new URL("../../../supabase/migrations/", import.meta.url);
    const file = readdirSync(dir).find((f) => f.endsWith("_s67_bp_rule_set_v4_and_maternal_guard.sql"))!;
    const sql = readFileSync(new URL(file, dir), "utf8");
    expect(sql).not.toMatch(/insert into public\.(go_live_guard_log|go_live_attestations|proposed_config_signoffs)/);
    expect(sql).not.toMatch(/set_go_live_guard\(/);
  });
});

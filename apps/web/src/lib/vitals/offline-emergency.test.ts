import { BP_CARE_V3, BP_CARE_V5, BP_CARE_V6, BP_CARE_V7, grade, type RuleSet, type SymptomCode, type TriageInput, type TriageResult } from "@tarragon/clinical";
import { activeWording, t } from "@tarragon/i18n";
import {
  gradeOfflineEmergency,
  isEmergencyAloneSymptom,
  isOfflineSymptom,
  offlineGuidanceWording,
  offlineSymptomLabelKey,
  OFFLINE_NOT_SAVED_BODY,
  OFFLINE_RULE_SET,
  OFFLINE_SYMPTOM_CANDIDATES,
  OFFLINE_SYMPTOMS,
  OFFLINE_SYMPTOMS_NOT_OFFERED,
  OFFLINE_UNCONFIRMED_BODY,
  SHIPPED_BP_RULE_SETS,
} from "./offline-emergency";

const NOW = Date.parse("2026-10-27T02:00:00Z");

type Flags = { pregnant: boolean; postpartum: boolean };
const FLAGS: Flags[] = [
  { pregnant: false, postpartum: false },
  { pregnant: true, postpartum: false },
  { pregnant: false, postpartum: true },
];

function serverResult(rules: RuleSet, systolic: number, diastolic: number, symptoms: readonly SymptomCode[], f: Flags): TriageResult {
  const now = new Date(NOW).toISOString();
  const input: TriageInput = {
    trigger: { type: "observation", reading: { systolic, diastolic, takenAt: now }, symptoms, symptomsAnswered: true },
    history: [],
    target: { systolic: 135, diastolic: 85 },
    pathway: { state: "self_guided" },
    pregnant: f.pregnant,
    postpartum: f.postpartum,
    ageYears: null,
    now,
  };
  return grade(input, rules);
}

const asksGuidance = (r: TriageResult): boolean => r.actions.some((a) => a.kind === "show_emergency_guidance") || (r.status === "graded" && r.grade === "red");

function serverSymptomOnly(rules: RuleSet, symptoms: readonly SymptomCode[], f: Flags): TriageResult {
  const now = new Date(NOW).toISOString();
  return grade(
    {
      trigger: { type: "symptom", symptoms },
      history: [],
      target: { systolic: 135, diastolic: 85 },
      pathway: { state: "self_guided" },
      pregnant: f.pregnant,
      postpartum: f.postpartum,
      ageYears: null,
      now,
    },
    rules,
  );
}

describe("offline emergency guidance on the web (INV-06)", () => {
  it("bundles the same rule set the phone falls back to", () => {
    expect(OFFLINE_RULE_SET).toBe(BP_CARE_V5);
  });

  it("a crisis reading shows the emergency guidance, with no symptom ticked", () => {
    const r = gradeOfflineEmergency({ systolic: 210, diastolic: 125, nowMs: NOW });
    expect(r.emergency).toBe(true);
    expect(r.code).toBe("EMG-001");
  });

  it("a ticked emergency symptom shows the guidance even beside a normal reading, and with no reading at all", () => {
    expect(gradeOfflineEmergency({ systolic: 118, diastolic: 76, symptoms: ["chest_pain"], nowMs: NOW }).emergency).toBe(true);
    expect(gradeOfflineEmergency({ symptoms: ["confusion"], nowMs: NOW })).toMatchObject({ emergency: true, reasons: ["symptom"] });
  });

  it("a normal reading with nothing ticked shows nothing", () => {
    expect(gradeOfflineEmergency({ systolic: 118, diastolic: 76, nowMs: NOW })).toEqual({ emergency: false, code: null, reasons: [] });
    expect(gradeOfflineEmergency({ nowMs: NOW }).emergency).toBe(false);
  });

  it("an unknown symptom code is ignored, never trusted", () => {
    expect(gradeOfflineEmergency({ symptoms: ["dizzy_spell"], nowMs: NOW }).emergency).toBe(false);
    expect(isOfflineSymptom("chest_pain")).toBe(true);
    expect(isOfflineSymptom("dizzy_spell")).toBe(false);
  });

  describe("pregnancy is unknown on the device (finding 1)", () => {
    it("165/105 is red on the server for a pregnant or postpartum patient (BP-P3): the web shows the guidance with no flag at all", () => {
      expect(asksGuidance(serverResult(BP_CARE_V5, 165, 105, [], { pregnant: true, postpartum: false }))).toBe(true);
      expect(asksGuidance(serverResult(BP_CARE_V5, 165, 105, [], { pregnant: false, postpartum: true }))).toBe(true);
      expect(asksGuidance(serverResult(BP_CARE_V5, 165, 105, [], { pregnant: false, postpartum: false }))).toBe(false);
      const web = gradeOfflineEmergency({ systolic: 165, diastolic: 105, nowMs: NOW });
      expect(web.emergency).toBe(true);
      expect(web.reasons).toContain("pregnancy_unknown");
    });

    it("the severe pregnancy lines are read from the rule set, not written here: a rule set with other lines changes the answer", () => {
      const { severeSystolic, severeDiastolic } = OFFLINE_RULE_SET.params.pregnancy;
      expect(gradeOfflineEmergency({ systolic: severeSystolic, diastolic: 60, nowMs: NOW }).emergency).toBe(true);
      expect(gradeOfflineEmergency({ systolic: 110, diastolic: severeDiastolic, nowMs: NOW }).emergency).toBe(true);
      expect(gradeOfflineEmergency({ systolic: severeSystolic - 1, diastolic: severeDiastolic - 1, nowMs: NOW }).reasons).not.toContain("pregnancy_unknown");
    });

    it("a raised reading with a pre-eclampsia symptom that is not otherwise an emergency (sudden swelling of face or hands) shows the guidance (BP-P4)", () => {
      const r = serverResult(BP_CARE_V5, 145, 95, ["sudden_face_hand_swelling"], { pregnant: true, postpartum: false });
      expect(asksGuidance(r)).toBe(true);
      expect(gradeOfflineEmergency({ systolic: 145, diastolic: 95, symptoms: ["sudden_face_hand_swelling"], nowMs: NOW }).emergency).toBe(true);
      // and the same symptom beside an ordinary reading, with nothing raised, shows nothing (it is only an emergency in pregnancy with a raised reading)
      expect(gradeOfflineEmergency({ systolic: 118, diastolic: 76, symptoms: ["sudden_face_hand_swelling"], nowMs: NOW }).emergency).toBe(false);
    });

    it("a convulsion or loss of consciousness is shown at once, as BP-P6 needs no reading in pregnancy", () => {
      expect(asksGuidance(serverResult(BP_CARE_V5, 118, 76, ["convulsion"], { pregnant: true, postpartum: false }))).toBe(true);
      expect(gradeOfflineEmergency({ symptoms: ["convulsion"], nowMs: NOW }).emergency).toBe(true);
      expect(gradeOfflineEmergency({ systolic: 118, diastolic: 76, symptoms: ["loss_of_consciousness"], nowMs: NOW }).emergency).toBe(true);
    });
  });

  describe("the guidance code is the engine's own (finding 4)", () => {
    it("80/50 with confusion gives EMG-001L and its signed wording, not the EMG-001 wording", () => {
      const server = serverResult(BP_CARE_V5, 80, 50, ["confusion"], FLAGS[0]!);
      expect(server.actions.find((a) => a.kind === "show_emergency_guidance")).toMatchObject({ code: "EMG-001L" });
      const web = gradeOfflineEmergency({ systolic: 80, diastolic: 50, symptoms: ["confusion"], nowMs: NOW });
      expect(web.emergency).toBe(true);
      expect(web.code).toBe("EMG-001L");
      expect(offlineGuidanceWording(web.code!)).toEqual(activeWording("EMG-001L"));
      expect(offlineGuidanceWording(web.code!)).not.toEqual(activeWording("EMG-001"));
    });

    it("fainting beside a low reading is also EMG-001L, and fainting beside a normal one shows nothing (the server has no rule for it)", () => {
      expect(gradeOfflineEmergency({ systolic: 85, diastolic: 55, symptoms: ["fainting"], nowMs: NOW }).code).toBe("EMG-001L");
      expect(gradeOfflineEmergency({ systolic: 118, diastolic: 76, symptoms: ["fainting"], nowMs: NOW }).emergency).toBe(false);
      expect(gradeOfflineEmergency({ symptoms: ["fainting"], nowMs: NOW }).emergency).toBe(false);
    });

    it("a crisis reading and a red-flag symptom keep EMG-001", () => {
      expect(gradeOfflineEmergency({ systolic: 210, diastolic: 125, nowMs: NOW }).code).toBe("EMG-001");
      expect(gradeOfflineEmergency({ symptoms: ["chest_pain"], nowMs: NOW }).code).toBe("EMG-001");
    });
  });

  describe("the symptoms offered come from the engine (finding 2)", () => {
    it("every symptom in any red or emergency server symptom group is offered, or left out with a recorded reason", () => {
      const emergencyGroups = new Set<string>();
      for (const set of SHIPPED_BP_RULE_SETS) {
        for (const r of set.rules) {
          if (r.result !== "grade" || !(r.grade === "red" || r.actions.some((a) => a.kind === "show_emergency_guidance"))) continue;
          const text = JSON.stringify(r.when);
          for (const g of Object.keys(set.params.symptomGroups)) if (text.includes(`"symptomGroup":"${g}"`)) emergencyGroups.add(`${set.version}:${g}`);
        }
      }
      expect(emergencyGroups.size).toBeGreaterThanOrEqual(5);
      const missing: string[] = [];
      for (const key of emergencyGroups) {
        const [version, group] = key.split(":");
        const set = SHIPPED_BP_RULE_SETS.find((s) => String(s.version) === version)!;
        for (const code of set.params.symptomGroups[group!] ?? []) {
          if (!(OFFLINE_SYMPTOMS as readonly string[]).includes(code) && OFFLINE_SYMPTOMS_NOT_OFFERED[code as SymptomCode] === undefined) missing.push(`${key} ${code}`);
        }
      }
      expect(missing).toEqual([]);
    });

    it("the named server groups are all there: red-flag, low-pressure, pre-eclampsia, obstetric emergency and the version 7 symptom-alone group", () => {
      const want = [
        ...BP_CARE_V5.params.symptomGroups.redFlag,
        ...(BP_CARE_V5.params.symptomGroups.lowBpFlag ?? []),
        ...(BP_CARE_V5.params.symptomGroups.preeclampsiaFlag ?? []),
        ...(BP_CARE_V5.params.symptomGroups.obstetricEmergency ?? []),
        ...(BP_CARE_V7.params.symptomGroups.symptomAloneEmergency ?? []),
      ];
      for (const code of new Set(want)) expect(OFFLINE_SYMPTOM_CANDIDATES as readonly string[]).toContain(code);
      for (const code of ["chest_pain", "weakness_or_numbness", "difficulty_speaking", "convulsion", "loss_of_consciousness", "fainting"]) expect(OFFLINE_SYMPTOMS as readonly string[]).toContain(code);
    });

    it("what is not offered is recorded with a reason and really is a candidate (no stale entries); non-emergency symptoms are not candidates", () => {
      for (const [code, reason] of Object.entries(OFFLINE_SYMPTOMS_NOT_OFFERED)) {
        expect(OFFLINE_SYMPTOM_CANDIDATES as readonly string[]).toContain(code);
        expect(reason!.length).toBeGreaterThan(30);
      }
      expect(OFFLINE_SYMPTOM_CANDIDATES as readonly string[]).not.toContain("dizziness");
      expect(OFFLINE_SYMPTOM_CANDIDATES as readonly string[]).not.toContain("palpitations");
    });

    it("sabotage: a candidate dropped from the offered list with no reason is found by the coverage check", () => {
      const without = OFFLINE_SYMPTOMS.filter((s) => s !== "chest_pain");
      const uncovered = OFFLINE_SYMPTOM_CANDIDATES.filter((c) => !(without as readonly string[]).includes(c) && OFFLINE_SYMPTOMS_NOT_OFFERED[c] === undefined);
      expect(uncovered).toEqual(["chest_pain"]);
    });

    it("every offered symptom has an existing patient label that is real text", () => {
      for (const code of OFFLINE_SYMPTOMS) {
        const label = t(offlineSymptomLabelKey(code));
        expect(label.length).toBeGreaterThan(3);
        expect(label).not.toMatch(/^vitals\.|^symptom\./);
      }
    });

    it("symptoms that are an emergency on their own are the red-flag, obstetric and symptom-alone ones; fainting and swelling need a reading", () => {
      for (const code of ["chest_pain", "confusion", "convulsion", "weakness_or_numbness"]) expect(isEmergencyAloneSymptom(code)).toBe(true);
      for (const code of ["fainting", "sudden_face_hand_swelling", "dizziness"]) expect(isEmergencyAloneSymptom(code)).toBe(false);
    });
  });

  type Web = (s: number, d: number, sym: SymptomCode[]) => boolean;
  const SETS: Array<[string, RuleSet]> = [["v3", BP_CARE_V3], ["v5", BP_CARE_V5], ["v6", BP_CARE_V6], ["v7", BP_CARE_V7]];
  const SYMPTOM_SETS: SymptomCode[][] = [[], ...OFFLINE_SYMPTOMS.map((s) => [s]), ["chest_pain", "confusion"], ["fainting", "confusion"], ["sudden_face_hand_swelling", "severe_headache"]];

  function misses(web: Web, flagSets: Flags[] = FLAGS): string[] {
    const out: string[] = [];
    for (let s = 70; s <= 260; s += 5) {
      for (let d = 40; d <= 150; d += 10) {
        for (const sym of SYMPTOM_SETS) {
          const shown = web(s, d, sym);
          if (shown) continue;
          for (const f of flagSets) {
            for (const [name, rules] of SETS) {
              if (asksGuidance(serverResult(rules, s, d, sym, f))) out.push(`${name} ${s}/${d} [${sym.join(",")}] ${f.pregnant ? "pregnant" : f.postpartum ? "postpartum" : "adult"}`);
            }
          }
        }
      }
    }
    return out;
  }

  it("never weaker than the server: every red or emergency the shipped rule sets give, the web also shows (readings x symptoms x adult, pregnant, postpartum)", () => {
    expect(misses((s, d, sym) => gradeOfflineEmergency({ systolic: s, diastolic: d, symptoms: sym, nowMs: NOW }).emergency)).toEqual([]);
  });

  it("never weaker for a symptom report with no reading either (version 7 BP-S1, BP-S2, BP-S3 and the pregnancy convulsion rule)", () => {
    const gaps: string[] = [];
    for (const [name, rules] of SETS) {
      for (const sym of OFFLINE_SYMPTOMS) {
        for (const f of FLAGS) {
          if (asksGuidance(serverSymptomOnly(rules, [sym], f)) && !gradeOfflineEmergency({ symptoms: [sym], nowMs: NOW }).emergency) gaps.push(`${name} ${sym} ${f.pregnant ? "pregnant" : f.postpartum ? "postpartum" : "adult"}`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it("sabotage: a web check that shows nothing, or only the reading band, or ignores pregnancy, or ignores ticked symptoms IS caught by the same grid", () => {
    expect(misses(() => false).length).toBeGreaterThan(0);
    expect(misses((s, d) => s >= 200 || d >= 120).length).toBeGreaterThan(0);
    // the first version of this file: graded as an ordinary adult only
    const adultOnly: Web = (s, d, sym) => {
      const keep = sym.filter(isOfflineSymptom);
      return asksGuidance(serverResult(OFFLINE_RULE_SET, s, d, keep, FLAGS[0]!)) || s >= 200 || d >= 120 || keep.some(isEmergencyAloneSymptom);
    };
    const pregnancyMisses = misses(adultOnly);
    expect(pregnancyMisses.some((m) => /pregnant|postpartum/.test(m))).toBe(true);
    expect(misses((s, d) => gradeOfflineEmergency({ systolic: s, diastolic: d, nowMs: NOW }).emergency).length).toBeGreaterThan(0);
  });

  it("uses the signed EMG-001 wording through activeWording, not text of its own", () => {
    expect(offlineGuidanceWording()).toEqual(activeWording("EMG-001"));
  });

  it("never claims the reading was saved or that anyone has seen it", () => {
    expect(OFFLINE_NOT_SAVED_BODY).toMatch(/nothing was sent/i);
    for (const text of [OFFLINE_NOT_SAVED_BODY, OFFLINE_UNCONFIRMED_BODY]) expect(text).not.toMatch(/\bsaved to\b|reviewed|has seen|doctor|care team/i);
    expect(OFFLINE_UNCONFIRMED_BODY).toMatch(/cannot tell/i);
    expect(OFFLINE_SYMPTOMS.length).toBeGreaterThan(0);
  });

  it("makes no request of any kind", () => {
    const realFetch = globalThis.fetch;
    let touched = 0;
    globalThis.fetch = (() => {
      touched += 1;
      throw new Error("network is off");
    }) as typeof fetch;
    try {
      gradeOfflineEmergency({ systolic: 210, diastolic: 125, nowMs: NOW });
      gradeOfflineEmergency({ systolic: 165, diastolic: 105, symptoms: ["convulsion"], nowMs: NOW });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(touched).toBe(0);
  });
});

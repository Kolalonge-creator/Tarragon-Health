import { BP_CARE_V3, BP_CARE_V5, BP_CARE_V6, BP_CARE_V7, grade, type RuleSet, type SymptomCode, type TriageInput } from "@tarragon/clinical";
import { activeWording } from "@tarragon/i18n";
import {
  gradeOfflineEmergency,
  isOfflineSymptom,
  OFFLINE_RULE_SET,
  OFFLINE_SYMPTOMS,
  offlineGuidanceWording,
  OFFLINE_NOT_SAVED_BODY,
} from "./offline-emergency";

const NOW = Date.parse("2026-10-27T02:00:00Z");

function serverGradeIsRed(rules: RuleSet, systolic: number, diastolic: number, symptoms: readonly SymptomCode[]): boolean {
  const now = new Date(NOW).toISOString();
  const input: TriageInput = {
    trigger: { type: "observation", reading: { systolic, diastolic, takenAt: now }, symptoms, symptomsAnswered: true },
    history: [],
    target: { systolic: 135, diastolic: 85 },
    pathway: { state: "self_guided" },
    pregnant: false,
    postpartum: false,
    ageYears: null,
    now,
  };
  const r = grade(input, rules);
  return r.actions.some((a) => a.kind === "show_emergency_guidance") || (r.status === "graded" && r.grade === "red");
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

  type Web = (s: number, d: number, sym: SymptomCode[]) => boolean;
  const SETS: Array<[string, RuleSet]> = [["v3", BP_CARE_V3], ["v5", BP_CARE_V5], ["v6", BP_CARE_V6], ["v7", BP_CARE_V7]];
  const SYMPTOM_SETS: SymptomCode[][] = [[], ["severe_headache"], ["chest_pain"], ["breathlessness"], ["visual_disturbance"], ["confusion"], ["chest_pain", "confusion"]];
  function misses(web: Web): string[] {
    const out: string[] = [];
    for (let s = 70; s <= 260; s += 10) {
      for (let d = 40; d <= 150; d += 10) {
        for (const sym of SYMPTOM_SETS) {
          const shown = web(s, d, sym);
          for (const [name, rules] of SETS) if (serverGradeIsRed(rules, s, d, sym) && !shown) out.push(`${name} ${s}/${d} [${sym.join(",")}]`);
        }
      }
    }
    return out;
  }

  it("never weaker than the server: every red or emergency the shipped rule sets give, the web also shows (grid of readings x symptoms)", () => {
    expect(misses((s, d, sym) => gradeOfflineEmergency({ systolic: s, diastolic: d, symptoms: sym, nowMs: NOW }).emergency)).toEqual([]);
  });

  it("sabotage: a web check that shows nothing, or only the reading band, IS caught by the same grid (the test can fail)", () => {
    expect(misses(() => false).length).toBeGreaterThan(0);
    // and one that keeps the crisis band but ignores ticked symptoms still misses a red with a symptom beside a lower reading
    expect(misses((s, d) => s >= 200 || d >= 120).length).toBeGreaterThan(0);
  });

  it("uses the signed EMG-001 wording through activeWording, not text of its own", () => {
    expect(offlineGuidanceWording()).toEqual(activeWording("EMG-001"));
  });

  it("never claims the reading was saved or that anyone has seen it", () => {
    expect(OFFLINE_NOT_SAVED_BODY).toMatch(/nothing was sent/i);
    expect(`${OFFLINE_NOT_SAVED_BODY}`).not.toMatch(/\bsaved to\b|reviewed|has seen|doctor/i);
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
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(touched).toBe(0);
  });
});

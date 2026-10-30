import { describe, expect, it } from "@jest/globals";
import { BP_CARE_V7, grade, type Grade, type Reading, type SymptomCode, type TriageInput } from "./index";

// A deterministic synthetic cohort (no real person, a fixed seed) pushed through the real triage engine. The fixtures in
// safety-cases.json check chosen cases; this checks rules that must hold for EVERY member the generator can make:
//   - the engine never throws and always answers with a known status;
//   - the same input always gives the same answer;
//   - a graded severe-range reading (systolic 180 or more, or diastolic 120 or more) is never green;
//   - every red result shows emergency guidance and pages on-call, and nothing that is not red pages;
//   - an emergency symptom together with a severe-range reading is red;
//   - within the hypertensive range, a higher systolic with everything else equal never gives a milder grade.
// What it does not show: that the thresholds are clinically right (the CMO signs those), or that real members look like this.

const NOW = "2026-10-05T09:00:00Z";
const SYMPTOMS: readonly SymptomCode[] = ["severe_headache", "chest_pain", "breathlessness", "weakness_or_numbness", "difficulty_speaking", "back_pain", "epigastric_pain", "confusion", "visual_disturbance", "fainting", "dizziness", "palpitations"];
const EMERGENCY: readonly SymptomCode[] = ["severe_headache", "chest_pain", "weakness_or_numbness", "difficulty_speaking", "confusion", "visual_disturbance"];
const rank: Record<Grade, number> = { green: 0, amber: 1, red: 2 };

// mulberry32: a small seeded generator so the cohort is the same on every machine.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Member { id: number; input: TriageInput }

function cohort(size: number, seed = 20261027): Member[] {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const members: Member[] = [];
  for (let id = 0; id < size; id += 1) {
    const baseSys = int(95, 215);
    const baseDia = Math.max(50, Math.min(135, baseSys - int(25, 70)));
    const history: Reading[] = [];
    for (let d = 1; d <= int(0, 12); d += 1) {
      history.push({ systolic: baseSys + int(-12, 12), diastolic: baseDia + int(-8, 8), takenAt: new Date(Date.parse(NOW) - d * 86_400_000).toISOString() });
    }
    const symptoms = r() < 0.4 ? Array.from(new Set(Array.from({ length: int(1, 3) }, () => pick(SYMPTOMS)))) : [];
    members.push({
      id,
      input: {
        trigger: { type: "observation", reading: { systolic: baseSys, diastolic: baseDia, takenAt: NOW }, symptoms },
        history,
        target: { systolic: pick([130, 135, 140]), diastolic: pick([80, 85, 90]) },
        pathway: { state: pick(["self_guided", "self_guided", "self_guided"] as const) },
        pregnant: false,
        ageYears: int(18, 90),
        now: NOW,
      },
    });
  }
  return members;
}

const COHORT = cohort(4000);
const reading = (m: Member): Reading => (m.input.trigger as { reading: Reading }).reading;
const symptomsOf = (m: Member): readonly SymptomCode[] => (m.input.trigger as { symptoms: readonly SymptomCode[] }).symptoms;
const withSystolic = (m: Member, systolic: number): TriageInput => ({ ...m.input, trigger: { type: "observation", reading: { ...reading(m), systolic }, symptoms: symptomsOf(m) } });

describe("synthetic cohort through the real BP triage engine", () => {
  it("is the same cohort every time and big enough to mean something", () => {
    expect(COHORT).toHaveLength(4000);
    expect(JSON.stringify(cohort(4000))).toBe(JSON.stringify(COHORT));
    expect(COHORT.filter((m) => reading(m).systolic >= 180).length).toBeGreaterThan(200);
    expect(COHORT.filter((m) => symptomsOf(m).length > 0).length).toBeGreaterThan(1000);
  });

  it("never throws, always answers with a known status, and is deterministic", () => {
    for (const m of COHORT) {
      const a = grade(m.input, BP_CARE_V7);
      expect(["graded", "recheck_required", "symptom_check_required", "rejected"]).toContain(a.status);
      expect(grade(m.input, BP_CARE_V7)).toEqual(a);
    }
  });

  it("a request to check symptoms or to recheck never pages and never grades", () => {
    let asked = 0;
    for (const m of COHORT) {
      const res = grade(m.input, BP_CARE_V7);
      if (res.status !== "symptom_check_required" && res.status !== "recheck_required") continue;
      asked += 1;
      expect(res.actions.map((a) => a.kind)).not.toContain("page_on_call");
      expect(res.grade).toBeNull();
    }
    expect(asked).toBeGreaterThan(50);
  });

  it("a graded severe-range reading is never green", () => {
    let checked = 0;
    for (const m of COHORT) {
      const rd = reading(m);
      if (rd.systolic < 180 && rd.diastolic < 120) continue;
      const res = grade(m.input, BP_CARE_V7);
      if (res.status !== "graded") continue;
      checked += 1;
      expect({ id: m.id, grade: res.grade }).not.toEqual({ id: m.id, grade: "green" });
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("every red shows emergency guidance and pages on-call; nothing else pages", () => {
    let reds = 0;
    for (const m of COHORT) {
      const res = grade(m.input, BP_CARE_V7);
      const kinds = res.actions.map((a) => a.kind);
      if (res.status === "graded" && res.grade === "red") {
        reds += 1;
        expect(kinds).toEqual(expect.arrayContaining(["show_emergency_guidance", "page_on_call"]));
      } else {
        expect(kinds).not.toContain("page_on_call");
      }
    }
    expect(reds).toBeGreaterThan(100);
  });

  it("an emergency symptom with a severe-range reading is red whenever the engine grades it", () => {
    let checked = 0;
    for (const m of COHORT) {
      const rd = reading(m);
      if ((rd.systolic < 180 && rd.diastolic < 120) || !symptomsOf(m).some((s) => EMERGENCY.includes(s))) continue;
      const res = grade(m.input, BP_CARE_V7);
      if (res.status !== "graded") continue;
      checked += 1;
      expect({ id: m.id, grade: res.grade }).toEqual({ id: m.id, grade: "red" });
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("within the hypertensive range, a higher systolic with everything else equal never gives a milder grade", () => {
    let pairs = 0;
    for (const m of COHORT) {
      const lo = reading(m).systolic;
      if (lo < 140 || lo > 200) continue;
      const a = grade(withSystolic(m, lo), BP_CARE_V7);
      const b = grade(withSystolic(m, lo + 10), BP_CARE_V7);
      if (a.status !== "graded" || b.status !== "graded") continue;
      pairs += 1;
      expect({ id: m.id, ok: rank[b.grade as Grade] >= rank[a.grade as Grade] }).toEqual({ id: m.id, ok: true });
    }
    expect(pairs).toBeGreaterThan(300);
  });

  it("the checks can fail: a rule set with its red rules removed is caught by the severe-range check", () => {
    const sabotaged = { ...BP_CARE_V7, rules: BP_CARE_V7.rules.filter((r) => r.grade !== "red") };
    const m = COHORT.find((x) => reading(x).systolic >= 190 && symptomsOf(x).some((s) => EMERGENCY.includes(s)))!;
    const real = grade(m.input, BP_CARE_V7);
    const broken = grade(m.input, sabotaged as typeof BP_CARE_V7);
    expect(real.status === "graded" && real.grade === "red").toBe(true);
    expect(broken.status === "graded" && broken.grade === "red").toBe(false);
  });
});

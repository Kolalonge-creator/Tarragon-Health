import {
  BP_CHECKLIST_SYMPTOMS,
  redFlagsAmong,
  RED_FLAG_CHECKLIST_SYMPTOMS,
  PREGNANCY_CHECKLIST_SYMPTOMS,
  TICKED_ON_BP_FORM_NOTE,
  planBpLog,
  type BpLogInput,
} from "./bp-checklist";
import { loadBpSymptomChecklist } from "./s07-config";
import { readFileSync } from "fs";
import { resolve } from "path";

const SEVERITY = 6; // pinned: the test covers the planner, not the proposed number
const base: BpLogInput = { systolic: "150", diastolic: "95", pulse: "", symptoms: [] };

describe("planBpLog", () => {
  it("plans just the blood pressure when nothing optional is given", () => {
    const plan = planBpLog(base, SEVERITY);
    expect(plan).toEqual({ ok: true, systolic: 150, diastolic: 95, pulse: null, symptoms: [], redFlagTicked: [], cuffType: null });
  });

  it("keeps a known cuff type and drops anything else", () => {
    expect(planBpLog({ ...base, cuffType: "wrist" }, SEVERITY)).toMatchObject({ ok: true, cuffType: "wrist" });
    expect(planBpLog({ ...base, cuffType: "upper_arm" }, SEVERITY)).toMatchObject({ cuffType: "upper_arm" });
    expect(planBpLog({ ...base, cuffType: "finger" as never }, SEVERITY)).toMatchObject({ cuffType: null });
    expect(planBpLog({ ...base, cuffType: null }, SEVERITY)).toMatchObject({ cuffType: null });
  });

  it("adds a companion pulse when one is typed and treats blank or spaces as none", () => {
    expect(planBpLog({ ...base, pulse: "72" }, SEVERITY)).toMatchObject({ ok: true, pulse: 72 });
    expect(planBpLog({ ...base, pulse: "   " }, SEVERITY)).toMatchObject({ ok: true, pulse: null });
  });

  it("refuses a pulse that is not a number or is out of range, and names the field", () => {
    expect(planBpLog({ ...base, pulse: "abc" }, SEVERITY)).toEqual({ ok: false, error: "number", field: "pulse" });
    expect(planBpLog({ ...base, pulse: "500" }, SEVERITY)).toEqual({ ok: false, error: "range_pulse", field: "pulse" });
    expect(planBpLog({ ...base, pulse: "10" }, SEVERITY)).toEqual({ ok: false, error: "range_pulse", field: "pulse" });
  });

  it("reuses the live blood pressure limits unchanged (60-260 / 30-160, systolic above diastolic)", () => {
    expect(planBpLog({ ...base, systolic: "261" }, SEVERITY)).toEqual({ ok: false, error: "range", field: "bp" });
    expect(planBpLog({ ...base, diastolic: "161" }, SEVERITY)).toEqual({ ok: false, error: "range", field: "bp" });
    expect(planBpLog({ ...base, systolic: "90", diastolic: "95" }, SEVERITY)).toEqual({ ok: false, error: "order", field: "bp" });
    expect(planBpLog({ ...base, systolic: "x" }, SEVERITY)).toEqual({ ok: false, error: "numbers", field: "bp" });
    expect(planBpLog({ ...base, systolic: "260", diastolic: "160" }, SEVERITY)).toMatchObject({ ok: true });
  });

  it("checks the blood pressure before the pulse, so one error is reported at a time", () => {
    expect(planBpLog({ ...base, systolic: "", pulse: "abc" }, SEVERITY)).toMatchObject({ ok: false, field: "bp" });
  });

  it("writes one symptom row per tick at the configured severity, with a note that it was ticked not rated", () => {
    const plan = planBpLog({ ...base, symptoms: ["dizziness", "chest_pain"] }, SEVERITY);
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    expect(plan.symptoms).toEqual([
      { symptom_type: "chest_pain", severity: 6, description: TICKED_ON_BP_FORM_NOTE },
      { symptom_type: "dizziness", severity: 6, description: TICKED_ON_BP_FORM_NOTE },
    ]);
  });

  it("lists each symptom once, in checklist order, and ignores anything not on the list", () => {
    const plan = planBpLog(
      { ...base, symptoms: ["dizziness", "dizziness", "chest_pain", "toothache" as never] },
      SEVERITY,
    );
    if (!plan.ok) throw new Error("expected ok");
    expect(plan.symptoms.map((s) => s.symptom_type)).toEqual(["chest_pain", "dizziness"]);
  });

  it("flags only the red-flag ticks for emergency guidance, and dizziness or palpitations alone do not", () => {
    const calm = planBpLog({ ...base, symptoms: ["dizziness", "palpitations"] }, SEVERITY);
    if (!calm.ok) throw new Error("expected ok");
    expect(calm.redFlagTicked).toEqual([]);
    const flagged = planBpLog({ ...base, symptoms: ["severe_headache", "dizziness", "confusion"] }, SEVERITY);
    if (!flagged.ok) throw new Error("expected ok");
    expect(flagged.redFlagTicked).toEqual(["severe_headache", "confusion"]);
  });

  it("keeps the red-flag set inside the checklist", () => {
    // the pregnancy emergencies (convulsion, loss of consciousness) are red flags too, offered with the pregnancy ticks
    for (const s of RED_FLAG_CHECKLIST_SYMPTOMS) expect([...BP_CHECKLIST_SYMPTOMS, ...PREGNANCY_CHECKLIST_SYMPTOMS]).toContain(s);
  });

  it("never records a tick as a patient-rated severity", () => {
    expect(TICKED_ON_BP_FORM_NOTE).toMatch(/not rated/i);
  });
});

describe("redFlagsAmong", () => {
  it("picks out the red-flag ticks without needing any numbers", () => {
    expect(redFlagsAmong(["dizziness", "chest_pain", "palpitations"])).toEqual(["chest_pain"]);
    expect(redFlagsAmong(["dizziness"])).toEqual([]);
    expect(redFlagsAmong([])).toEqual([]);
  });

  it("is what the form asks first, so an invalid reading with a red-flag tick still has something to show", () => {
    const invalid = planBpLog({ systolic: "", diastolic: "", pulse: "", symptoms: ["chest_pain"] }, SEVERITY);
    expect(invalid.ok).toBe(false);
    expect(redFlagsAmong(["chest_pain"])).toEqual(["chest_pain"]);
  });
});

describe("symptom checklist config", () => {
  it("loads a severity from the registry in the 1 to 10 range", () => {
    const c = loadBpSymptomChecklist();
    expect(c.severity).toBeGreaterThanOrEqual(1);
    expect(c.severity).toBeLessThanOrEqual(10);
  });

  // OQ-82: the server pages a ticked trouble-breathing (and every other red-flag tick) from this stored severity. The database proof
  // packages/db/tests/bp_form_ticks_page_clinician.sql proves paging at the severity named in its BP_FORM_SEVERITY line; if the config moves
  // away from it the proof would no longer describe what the phone sends, so the two must change together.
  it("stores a tick at exactly the severity the database proof shows paging", () => {
    const proof = readFileSync(resolve(__dirname, "../../../../packages/db/tests/bp_form_ticks_page_clinician.sql"), "utf8");
    const m = /BP_FORM_SEVERITY=(\d+)/.exec(proof);
    expect(m).not.toBeNull();
    expect(loadBpSymptomChecklist().severity).toBe(Number(m?.[1]));
  });
});

describe("weakness, numbness and trouble speaking ticks (OQ-83)", () => {
  it("are on the checklist, logged as the existing server symptom types, and bring up the emergency guidance at once", () => {
    const plan = planBpLog({ ...base, symptoms: ["difficulty_speaking", "weakness_or_numbness", "dizziness"] }, SEVERITY);
    if (!plan.ok) throw new Error("expected ok");
    expect(plan.symptoms.map((s) => s.symptom_type)).toEqual(["weakness_or_numbness", "difficulty_speaking", "dizziness"]);
    expect(plan.redFlagTicked).toEqual(["weakness_or_numbness", "difficulty_speaking"]);
    for (const s of plan.symptoms) expect(s.severity).toBe(SEVERITY);
  });

  it("show their guidance when the numbers are blank, like every other red-flag tick", () => {
    expect(redFlagsAmong(["weakness_or_numbness"])).toEqual(["weakness_or_numbness"]);
    expect(redFlagsAmong(["difficulty_speaking"])).toEqual(["difficulty_speaking"]);
  });

  it("leave the other ticks exactly as they were (trouble breathing is still a red-flag tick, dizziness and palpitations are not)", () => {
    expect(redFlagsAmong(["breathlessness", "dizziness", "palpitations"])).toEqual(["breathlessness"]);
  });
});

import {
  buildMedicineProposal,
  buildScheduleProposal,
  buildTargetProposal,
  proposeMedicineChangeSchema,
  proposeScheduleChangeSchema,
  proposeTargetChangeSchema,
  rejectChangeSchema,
  signChangeSchema,
} from "./schemas";

const PATIENT = "6f1c2a52-8c0e-4d57-9b7f-0d2b6a1f4e11";
const MED = "7a1c2a52-8c0e-4d57-9b7f-0d2b6a1f4e22";
const PLAN = "8b1c2a52-8c0e-4d57-9b7f-0d2b6a1f4e33";
const RATIONALE = "Home readings stay above the target";
const ITEM = { drug_name: " Amlodipine ", dose: "10 mg", duration_days: "30", quantity: "30 tablets", frequency: "", repeats_allowed: "" };

describe("proposeMedicineChangeSchema", () => {
  it("accepts a start, trims text, drops empty optional fields and coerces numbers", () => {
    const parsed = proposeMedicineChangeSchema.parse({ action: "start", patientId: PATIENT, item: ITEM, rationale: RATIONALE });
    expect(buildMedicineProposal(parsed)).toEqual({
      action: "start",
      item: { drug_name: "Amlodipine", dose: "10 mg", duration_days: 30, quantity: "30 tablets" },
    });
  });

  it("a change carries the medication id and the full item; a stop carries only the id", () => {
    const change = proposeMedicineChangeSchema.parse({ action: "change", patientId: PATIENT, medicationId: MED, item: ITEM, rationale: RATIONALE });
    expect(buildMedicineProposal(change)).toMatchObject({ action: "change", medication_id: MED });
    const stop = proposeMedicineChangeSchema.parse({ action: "stop", patientId: PATIENT, medicationId: MED, rationale: RATIONALE });
    expect(buildMedicineProposal(stop)).toEqual({ action: "stop", medication_id: MED });
  });

  it("refuses a missing rationale, quantity, duration or a non-uuid id", () => {
    const base = { action: "start", patientId: PATIENT, item: ITEM, rationale: RATIONALE };
    expect(proposeMedicineChangeSchema.safeParse({ ...base, rationale: "short" }).success).toBe(false);
    expect(proposeMedicineChangeSchema.safeParse({ ...base, item: { ...ITEM, quantity: "" } }).success).toBe(false);
    expect(proposeMedicineChangeSchema.safeParse({ ...base, item: { ...ITEM, duration_days: "0" } }).success).toBe(false);
    expect(proposeMedicineChangeSchema.safeParse({ ...base, item: { ...ITEM, duration_days: "abc" } }).success).toBe(false);
    expect(proposeMedicineChangeSchema.safeParse({ ...base, patientId: "nope" }).success).toBe(false);
    expect(proposeMedicineChangeSchema.safeParse({ action: "change", patientId: PATIENT, item: ITEM, rationale: RATIONALE }).success).toBe(false);
    expect(proposeMedicineChangeSchema.safeParse({ action: "delete", patientId: PATIENT, rationale: RATIONALE }).success).toBe(false);
  });
});

describe("target and schedule schemas", () => {
  it("builds target ranges with a slugged key and numeric bounds", () => {
    const parsed = proposeTargetChangeSchema.parse({
      patientId: PATIENT,
      carePlanId: PLAN,
      rationale: RATIONALE,
      entries: [{ key: "Blood pressure systolic", min: "90", max: "130" }, { key: "pulse", min: "", max: "100" }],
    });
    expect(buildTargetProposal(parsed)).toEqual({
      target_ranges: { blood_pressure_systolic: { min: 90, max: 130 }, pulse: { max: 100 } },
    });
  });

  it("refuses a target with no bounds, lowest above highest, or a repeated target", () => {
    const base = { patientId: PATIENT, carePlanId: PLAN, rationale: RATIONALE };
    expect(proposeTargetChangeSchema.safeParse({ ...base, entries: [{ key: "pulse", min: "", max: "" }] }).success).toBe(false);
    expect(proposeTargetChangeSchema.safeParse({ ...base, entries: [{ key: "pulse", min: "120", max: "100" }] }).success).toBe(false);
    expect(proposeTargetChangeSchema.safeParse({ ...base, entries: [{ key: "pulse", max: "100" }, { key: "Pulse", max: "90" }] }).success).toBe(false);
    expect(proposeTargetChangeSchema.safeParse({ ...base, entries: [] }).success).toBe(false);
    expect(proposeTargetChangeSchema.safeParse({ ...base, carePlanId: "x", entries: [{ key: "pulse", max: "100" }] }).success).toBe(false);
  });

  it("builds a reading schedule and refuses an empty value", () => {
    const parsed = proposeScheduleChangeSchema.parse({
      patientId: PATIENT,
      carePlanId: PLAN,
      rationale: RATIONALE,
      entries: [{ key: "Blood pressure", value: " twice a day " }],
    });
    expect(buildScheduleProposal(parsed)).toEqual({ reading_schedule: { blood_pressure: "twice a day" } });
    expect(proposeScheduleChangeSchema.safeParse({ patientId: PATIENT, carePlanId: PLAN, rationale: RATIONALE, entries: [{ key: "bp", value: " " }] }).success).toBe(false);
  });
});

describe("signChangeSchema and rejectChangeSchema", () => {
  const ids = { patientId: PATIENT, changeId: MED };
  it("signing needs a plain-language summary and never defaults the allergy confirmation to true", () => {
    expect(signChangeSchema.safeParse({ ...ids, patientSummary: "" }).success).toBe(false);
    expect(signChangeSchema.safeParse({ ...ids, patientSummary: "short" }).success).toBe(false);
    const ok = signChangeSchema.parse({ ...ids, patientSummary: "Your care team wants to raise your dose." });
    expect(ok.allergiesConfirmed).toBe(false);
    expect(ok.overrideReason).toBeUndefined();
  });

  it("rejecting needs a reason", () => {
    expect(rejectChangeSchema.safeParse({ ...ids, reason: " " }).success).toBe(false);
    expect(rejectChangeSchema.safeParse({ ...ids, reason: "Not needed now" }).success).toBe(true);
  });
});

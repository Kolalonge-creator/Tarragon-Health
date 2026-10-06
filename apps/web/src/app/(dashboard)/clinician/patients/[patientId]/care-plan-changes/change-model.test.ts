import { describeChange, describeEngineInputs, describeNoProposalReason, describeSafetyChecks, parseStaffCareChanges, stateSummary } from "./change-model";

const fmt = (iso: string) => iso.slice(0, 10);
const ROW = {
  id: "c1",
  kind: "medication",
  state: "signed",
  proposed_by: "engine",
  proposed_by_user: "u1",
  signed_by: "u2",
  proposal: { action: "change", medication_id: "m1", item: { drug_name: "Amlodipine", dose: "10 mg", duration_days: 30, quantity: "30 tablets" } },
  before: { drug_name: "Amlodipine", dose: "5 mg" },
  rationale: "Above target",
  protocol_version: 2,
  engine_inputs: { average_systolic: 152, readings: [1, 2] },
  signed_at: "2026-10-06T10:00:00Z",
  expires_at: "2026-10-13T10:00:00Z",
};

describe("parseStaffCareChanges", () => {
  it("parses a row, resolves names, and never prints an unknown id as a name", () => {
    const [change] = parseStaffCareChanges([ROW], { u1: "Dr Ade" });
    expect(change).toMatchObject({ id: "c1", proposedBy: "engine", proposedByName: "Dr Ade", signedByName: null, protocolVersion: 2 });
  });

  it("drops rows that do not look right and survives non-arrays", () => {
    expect(parseStaffCareChanges([{ id: "x" }, null, "s", { ...ROW, kind: "other" }, { ...ROW, proposal: null }])).toEqual([]);
    expect(parseStaffCareChanges(null)).toEqual([]);
  });
});

describe("stateSummary", () => {
  const base = parseStaffCareChanges([ROW])[0]!;
  it("says what each state means for the patient", () => {
    expect(stateSummary({ ...base, state: "proposed" }, fmt)).toMatch(/patient cannot see it/);
    expect(stateSummary(base, fmt)).toBe("Waiting for the patient. It lapses on 2026-10-13 if they do not answer.");
    expect(stateSummary({ ...base, state: "confirmed", patientConfirmedAt: "2026-10-08T00:00:00Z" }, fmt)).toMatch(/Confirmed by the patient on 2026-10-08 and applied/);
    expect(stateSummary({ ...base, state: "declined", patientDeclinedAt: "2026-10-08T00:00:00Z" }, fmt)).toMatch(/Nothing was changed/);
    expect(stateSummary({ ...base, state: "expired", expiredAt: null }, fmt)).toMatch(/Lapsed on 2026-10-13/);
    expect(stateSummary({ ...base, state: "rejected", rejectedAt: null }, fmt)).toMatch(/Rejected\./);
  });
});

describe("describeChange and engine evidence", () => {
  it("shows before and after for a medicine change and a stop", () => {
    const change = parseStaffCareChanges([ROW])[0]!;
    expect(describeChange(change)).toEqual({
      heading: "Change a medicine",
      before: "Amlodipine, 5 mg",
      after: "Amlodipine, 10 mg, for 30 days, quantity 30 tablets",
    });
    expect(describeChange({ ...change, proposal: { action: "stop", medication_id: "m1" } }).after).toBe("Stop taking it");
  });

  it("describes target and schedule changes as plain lines", () => {
    const base = parseStaffCareChanges([ROW])[0]!;
    const target = describeChange({ ...base, kind: "target", before: { target_ranges: { pulse: { max: 100 } } }, proposal: { target_ranges: { blood_pressure: { min: 90, max: 130 } } } });
    expect(target.before).toBe("pulse: up to 100");
    expect(target.after).toBe("blood pressure: 90 to 130");
    const schedule = describeChange({ ...base, kind: "reading_schedule", before: null, proposal: { reading_schedule: { blood_pressure: "twice a day" } } });
    expect(schedule.before).toBe("Nothing set");
    expect(schedule.after).toBe("blood pressure: twice a day");
  });

  it("lists every engine input, including nested ones and unknowns", () => {
    expect(describeEngineInputs({ average_systolic: 152, readings: [1, 2], pregnancy: null })).toEqual([
      { label: "average systolic", value: "152" },
      { label: "readings", value: "[1,2]" },
      { label: "pregnancy", value: "not known" },
    ]);
    expect(describeEngineInputs(null)).toEqual([]);
  });

  it("describes the safety record: findings, confirmation and the override reason", () => {
    expect(
      describeSafetyChecks({ findings: [{ code: "allergy_match", allergen: "Penicillin" }, { code: "allergies_unrecorded" }], allergies_confirmed: true, override_reason: "Tolerated before" })
    ).toEqual(["Allergy match: Penicillin", "Allergy list was empty", "Signer confirmed the allergy list was checked", "Reason for going ahead: Tolerated before"]);
    expect(describeSafetyChecks({ findings: [] })).toEqual(["No findings"]);
    expect(describeSafetyChecks(null)).toEqual([]);
  });
});

describe("describeNoProposalReason", () => {
  it("uses the shipped catalogue with and without a detail, and never prints a placeholder", () => {
    expect(describeNoProposalReason({ code: "low_adherence", detail: "40 percent" })).toContain("40 percent");
    const bare = describeNoProposalReason({ code: "too_few_readings" });
    expect(bare).not.toContain("{detail}");
    expect(bare).toMatch(/not enough usable home readings/);
  });

  it("shows an unknown code in words instead of hiding it", () => {
    expect(describeNoProposalReason({ code: "something_new" })).toBe('The check "something new" stopped a suggestion.');
  });

  it("no message uses an em dash", () => {
    for (const code of ["pregnancy_or_unknown", "open_red_triage", "final_step_reached", "no_matching_step"]) {
      expect(describeNoProposalReason({ code, detail: "x" })).not.toContain("—");
    }
  });
});

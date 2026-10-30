import { needsDemographics, planDemographicsUpdate } from "./demographics";

const patient = { role: "patient", sex: null, dateOfBirth: null, receivesCare: true, isDependent: false };

describe("needsDemographics", () => {
  it("asks a patient missing either value", () => {
    expect(needsDemographics(patient)).toBe(true);
    expect(needsDemographics({ ...patient, sex: "female" })).toBe(true);
    expect(needsDemographics({ ...patient, dateOfBirth: "1985-05-05" })).toBe(true);
  });
  it("does not ask a patient who has both", () => {
    expect(needsDemographics({ ...patient, sex: "male", dateOfBirth: "1985-05-05" })).toBe(false);
  });
  it("never asks staff, a funder-only account or a dependant", () => {
    expect(needsDemographics({ ...patient, role: "clinician" })).toBe(false);
    expect(needsDemographics({ ...patient, role: "admin" })).toBe(false);
    expect(needsDemographics({ ...patient, receivesCare: false })).toBe(false);
    expect(needsDemographics({ ...patient, isDependent: true })).toBe(false);
  });
});

describe("planDemographicsUpdate", () => {
  it("requires a sex when sex is missing", () => {
    expect(planDemographicsUpdate({ sex: null, dateOfBirth: "1985-05-05" }, { sex: null, dateOfBirth: "" })).toEqual({ ok: false, reason: "sex_required" });
    expect(planDemographicsUpdate({ sex: null, dateOfBirth: "1985-05-05" }, { sex: "other", dateOfBirth: "" })).toEqual({ ok: false, reason: "sex_required" });
  });
  it("requires a real adult date of birth when it is missing", () => {
    expect(planDemographicsUpdate({ sex: "male", dateOfBirth: null }, { sex: null, dateOfBirth: "nonsense" })).toEqual({ ok: false, reason: "dob_invalid" });
    const y = new Date().getFullYear() - 10;
    expect(planDemographicsUpdate({ sex: "male", dateOfBirth: null }, { sex: null, dateOfBirth: `${y}-01-01` })).toEqual({ ok: false, reason: "dob_underage" });
  });
  it("writes only what is missing and only while it is still empty", () => {
    const plan = planDemographicsUpdate({ sex: null, dateOfBirth: null }, { sex: "female", dateOfBirth: "1985-05-05" });
    expect(plan).toEqual({ ok: true, patch: { sex: "female", date_of_birth: "1985-05-05" }, onlyIfNull: ["sex", "date_of_birth"] });
  });
  it("never overwrites a value already on file", () => {
    const plan = planDemographicsUpdate({ sex: "male", dateOfBirth: null }, { sex: "female", dateOfBirth: "1985-05-05" });
    expect(plan).toEqual({ ok: true, patch: { date_of_birth: "1985-05-05" }, onlyIfNull: ["date_of_birth"] });
    const plan2 = planDemographicsUpdate({ sex: null, dateOfBirth: "1985-05-05" }, { sex: "female", dateOfBirth: "2001-01-01" });
    expect(plan2).toEqual({ ok: true, patch: { sex: "female" }, onlyIfNull: ["sex"] });
  });
});

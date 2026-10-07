import type { EmergencyClinicalFacts } from "@/lib/emergency/card";
import { PROVENANCE_LABEL, buildDoctorSummary, type DoctorSummaryInput } from "./doctor-summary";

const FACTS: EmergencyClinicalFacts = {
  full_name: "Ada Okafor",
  date_of_birth: "1980-02-01",
  sex: "female",
  patient_number: "TH-000057",
  emergency_contact: { name: "Chi Okafor", phone: "+2348012345678", relationship: "sister" },
  allergies: [{ allergen: "Penicillin", reaction: "hives", severity: "severe" }],
  medications: [{ drug_name: "Metformin", dose: "500 mg", frequency: "twice daily" }],
  conditions: ["diabetes", "hypertension"],
  blood: { blood_group: "O+", genotype: "AA", note: null, provenance: "patient_attested", recorded_at: null },
};

function input(over: Partial<DoctorSummaryInput> = {}): DoctorSummaryInput {
  return { facts: FACTS, vitals: [], labs: [], vaccinations: [], procedures: [], family: [], now: new Date("2026-10-07T10:00:00Z"), ...over };
}
const section = (s: ReturnType<typeof buildDoctorSummary>, key: string) => s.sections.find((x) => x.key === key)!;

describe("buildDoctorSummary", () => {
  it("carries identity, the date it was made, the blood group and the emergency contact", () => {
    const s = buildDoctorSummary(input());
    expect(s.patient).toMatchObject({ name: "Ada Okafor", sex: "female", patientNumber: "TH-000057" });
    expect(s.patient.dateOfBirth).toBe("1 Feb 1980");
    expect(s.generatedOn).toBe("7 Oct 2026");
    expect(s.blood?.text).toBe("Blood group O+, genotype AA");
    expect(s.emergencyContact?.text).toContain("+2348012345678");
  });

  it("a patient-attested blood group is tagged as entered by the patient, a lab document as from a laboratory", () => {
    expect(buildDoctorSummary(input()).blood?.provenance).toBe("patient");
    const lab = { ...FACTS, blood: { ...FACTS.blood!, provenance: "lab_document" } };
    expect(buildDoctorSummary(input({ facts: lab })).blood?.provenance).toBe("laboratory");
  });

  it("every line says who stands behind it, and an unverified line never claims a clinician", () => {
    const s = buildDoctorSummary(
      input({
        vitals: [{ vitalType: "blood_pressure", text: "130/85 mmHg", takenAt: "2026-10-01T09:00:00Z", source: "wearable" }],
        procedures: [{ name: "Appendicectomy", when: "2012", verified: false }, { name: "Hernia repair", when: "2018", verified: true }],
        vaccinations: [{ name: "Yellow fever", doseNumber: 1, givenAt: "2020-01-01", verified: false }],
      })
    );
    const procs = section(s, "procedures").lines;
    expect(procs[0].provenance).toBe("patient");
    expect(procs[1].provenance).toBe("clinician_confirmed");
    expect(section(s, "vitals").lines[0].provenance).toBe("device");
    expect(PROVENANCE_LABEL[section(s, "vitals").lines[0].provenance]).toMatch(/estimate/);
    expect(section(s, "vaccinations").lines[0].provenance).toBe("patient");
    for (const sec of s.sections) for (const l of sec.lines) expect(PROVENANCE_LABEL[l.provenance]).toBeTruthy();
  });

  it("says None recorded rather than leaving a section out", () => {
    const s = buildDoctorSummary(input({ facts: { ...FACTS, allergies: [], medications: [], conditions: [] } }));
    expect(section(s, "allergies").lines).toEqual([]);
    expect(section(s, "allergies").emptyText).toBe("None recorded");
    expect(s.sections.map((x) => x.key)).toEqual(["allergies", "medications", "conditions", "vitals", "labs", "vaccinations", "procedures", "family"]);
  });

  it("lab lines carry the laboratory's own range and flag, all tagged from a laboratory", () => {
    const s = buildDoctorSummary(input({ labs: [{ code: "hba1c", text: "6.9 %", takenAt: "2026-09-01T00:00:00Z", range: "4 to 5.6", flag: "high" }] }));
    const line = section(s, "labs").lines[0];
    expect(line.detail).toContain("lab range 4 to 5.6");
    expect(line.detail).toContain("high");
    expect(line.provenance).toBe("laboratory");
  });

  it("never includes mental health or reproductive sections", () => {
    const keys = buildDoctorSummary(input()).sections.map((s) => s.key.toLowerCase()).join(" ");
    expect(keys).not.toMatch(/mental|reproduct|menstrual|pregnan|fertil|contracep/);
  });

  it("still builds when identity pieces are missing", () => {
    const s = buildDoctorSummary(input({ facts: { ...FACTS, full_name: null, date_of_birth: null, emergency_contact: null, blood: null } }));
    expect(s.patient.name).toBe("Patient");
    expect(s.patient.dateOfBirth).toBeNull();
    expect(s.emergencyContact).toBeNull();
    expect(s.blood).toBeNull();
  });
});

import { describe, expect, it } from "@jest/globals";
import { en } from "@tarragon/i18n";
import { checkMedicineList, checkMedicineOnAdd, type AddCheckAdviceKey } from "./add-check";
import type { MedicationInput } from "./safety/drug-safety";

const med = (id: string, drugName: string, extra: Partial<MedicationInput> = {}): MedicationInput => ({ id, drugName, ...extra });

describe("checkMedicineOnAdd (spec 8.7)", () => {
  it("ACCEPTANCE: adding a second ACE inhibitor raises a duplicate warning", () => {
    const r = checkMedicineOnAdd("Ramipril", [med("1", "Lisinopril 10mg")]);
    const dup = r.findings.find((f) => f.kind === "duplicate");
    expect(dup?.adviceKey).toBe("medicines.addcheck.advice.duplicate");
    expect(dup?.drugNames).toEqual(expect.arrayContaining(["Lisinopril 10mg", "Ramipril"]));
  });

  it("flags an ACE inhibitor with an ARB as a high-priority interaction, ranked first", () => {
    const r = checkMedicineOnAdd("Losartan", [med("1", "Lisinopril"), med("2", "Paracetamol")]);
    expect(r.findings[0]).toMatchObject({ kind: "interaction", severity: "contraindicated", adviceKey: "medicines.addcheck.advice.high" });
  });

  it("maps caution to review and info to note", () => {
    const caution = checkMedicineOnAdd("Ibuprofen", [med("1", "Lisinopril")]);
    expect(caution.findings.find((f) => f.severity === "caution")?.adviceKey).toBe("medicines.addcheck.advice.review");
    const info = checkMedicineOnAdd("Omeprazole", [med("1", "Levothyroxine")]);
    expect(info.findings.find((f) => f.severity === "info")?.adviceKey).toBe("medicines.addcheck.advice.note");
  });

  it("ranks several findings most severe first", () => {
    const r = checkMedicineOnAdd("Ibuprofen", [med("1", "Lisinopril"), med("2", "Warfarin")]);
    const sev = r.findings.map((f) => f.severity);
    expect(sev.length).toBeGreaterThan(1);
    expect(sev[0]).toBe("contraindicated");
  });

  it("only reports findings that involve the new medicine", () => {
    const r = checkMedicineOnAdd("Paracetamol", [med("1", "Lisinopril"), med("2", "Losartan")]);
    expect(r.findings).toEqual([]);
  });

  it("returns nothing for a blank name and never claims completeness or any change", () => {
    const r = checkMedicineOnAdd("   ", [med("1", "Lisinopril")]);
    expect(r).toEqual({ findings: [], isAdvisoryOnly: true, complete: false, changesAnything: false });
  });

  it("never changes the list it was given", () => {
    const existing = [med("1", "Lisinopril")];
    const copy = JSON.stringify(existing);
    checkMedicineOnAdd("Losartan", existing);
    expect(JSON.stringify(existing)).toBe(copy);
  });
});

describe("checkMedicineList", () => {
  it("gives patient-safe findings for interactions and duplicates only, most severe first", () => {
    const f = checkMedicineList([med("1", "Lisinopril"), med("2", "Losartan"), med("3", "Ibuprofen"), med("4", "Enalapril")]);
    expect(f.length).toBeGreaterThan(1);
    expect(f[0].severity).toBe("contraindicated");
    for (const x of f) expect(["interaction", "duplicate"]).toContain(x.kind);
    expect(f.some((x) => x.kind === "duplicate")).toBe(true);
  });
  it("returns nothing for a list with no findings", () => {
    expect(checkMedicineList([med("1", "Paracetamol")])).toEqual([]);
    expect(checkMedicineList([])).toEqual([]);
  });
});

describe("patient-facing advice wording", () => {
  const keys: AddCheckAdviceKey[] = [
    "medicines.addcheck.advice.high",
    "medicines.addcheck.advice.review",
    "medicines.addcheck.advice.note",
    "medicines.addcheck.advice.duplicate",
  ];
  it("every advice sentence exists, says your care team, and never tells the patient to stop a medicine", () => {
    for (const k of keys) {
      const text = en[k];
      expect(text).toMatch(/care team/);
      expect(text).not.toMatch(/\bstop (taking|one|it|them)\b/i);
      expect(text).not.toContain("—");
    }
    expect(en["medicines.addcheck.advice.high"]).toMatch(/Do not stop a medicine your care team prescribed/);
    expect(en["medicines.addcheck.advice.duplicate"]).toMatch(/Do not stop a prescribed medicine on your own/);
  });
  it("the limits sentence says a clean result is not a safety statement", () => {
    expect(en["medicines.addcheck.limits"]).toMatch(/No warning does not mean/);
  });
});

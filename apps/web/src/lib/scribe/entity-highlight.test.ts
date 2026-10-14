import { readFileSync } from "node:fs";
import { join } from "node:path";
import { entitiesIn, splitEntities } from "./entity-highlight";
import { SCRIBE_DRUG_NAMES, SCRIBE_DRUG_SET } from "./drug-names";

const kinds = (text: string) => splitEntities(text).filter((p) => p.kind).map((p) => `${p.kind}:${p.text}`);

describe("splitEntities", () => {
  it("marks a drug name and its dose", () => {
    expect(kinds("Start amlodipine 5 mg once daily.")).toEqual(["drug:amlodipine", "number:5 mg"]);
  });
  it("marks a blood pressure as one number and every drug in a list", () => {
    expect(kinds("BP 150/90. Metformin 500mg twice daily, Losartan 50 mg.")).toEqual(["number:150/90", "drug:Metformin", "number:500mg", "drug:Losartan", "number:50 mg"]);
  });
  it("keeps decimals and thousands together and recognises units", () => {
    expect(kinds("Give 2.5 mg, 1,200 ml in 3 days, 40% of dose")).toEqual(["number:2.5 mg", "number:1,200 ml", "number:3 days", "number:40%"]);
  });
  it("is case insensitive for drugs, ignores ordinary words, and handles brand names", () => {
    expect(kinds("PARACETAMOL and Panadol for the patient")).toEqual(["drug:PARACETAMOL", "drug:Panadol"]);
    expect(kinds("The patient feels well today")).toEqual([]);
  });
  it("does not change the text: the parts always join back to the original", () => {
    for (const text of ["", "Take amlodipine 5 mg.", "no entities here", "120/80 then 130/85, metformin; 2 tablets", "Ünïcode ok 5"]) {
      expect(splitEntities(text).map((p) => p.text).join("")).toBe(text);
    }
  });
  it("does not mark a word that merely contains a drug name", () => {
    expect(kinds("The metforminlike effect and warfarinised blood")).toEqual([]);
  });
});

describe("entitiesIn", () => {
  it("lists each distinct drug and number once, in order", () => {
    expect(entitiesIn("Metformin 500 mg now, metformin 500 mg later, then 1000 mg")).toEqual([
      { kind: "drug", text: "Metformin" }, { kind: "number", text: "500 mg" }, { kind: "number", text: "1000 mg" },
    ]);
    expect(entitiesIn("")).toEqual([]);
  });
});

describe("the drug list", () => {
  it("is the same list the speech evaluation harness uses", () => {
    const json = JSON.parse(readFileSync(join(process.cwd(), "..", "..", "scripts", "asr-eval", "drug-names.json"), "utf8")) as { groups: Record<string, string[]>; brand_names_commonly_said: string[] };
    const fromJson = [...Object.values(json.groups).flat(), ...json.brand_names_commonly_said].map((n) => n.toLowerCase());
    expect([...new Set(fromJson)].sort()).toEqual([...SCRIBE_DRUG_NAMES].sort());
  });
  it("is lower case, one word, no duplicates, and covers the lab-monitored and controlled medicines", () => {
    expect(SCRIBE_DRUG_NAMES.every((n) => n === n.toLowerCase() && /^[a-z]+$/.test(n))).toBe(true);
    expect(SCRIBE_DRUG_SET.size).toBe(SCRIBE_DRUG_NAMES.length);
    for (const n of ["metformin", "warfarin", "tramadol", "amlodipine", "gliclazide"]) expect(SCRIBE_DRUG_SET.has(n)).toBe(true);
  });
});

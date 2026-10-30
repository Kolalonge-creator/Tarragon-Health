import { controlledSubstanceInfo } from "./controlled-substances";
import type { ControlledMedicineList } from "./controlled-medicine-list";

describe("controlledSubstanceInfo", () => {
  it("flags a narcotic-class opioid", () => {
    const result = controlledSubstanceInfo("Morphine");
    expect(result?.tier).toBe("narcotic");
    expect(result?.label).toBe("Opioid analgesic");
  });

  it("flags a lower-schedule opioid as restricted, not narcotic", () => {
    expect(controlledSubstanceInfo("Tramadol")?.tier).toBe("restricted");
  });

  it("flags a benzodiazepine as restricted", () => {
    expect(controlledSubstanceInfo("Diazepam 5mg")?.tier).toBe("restricted");
  });

  it("flags a stimulant as narcotic", () => {
    expect(controlledSubstanceInfo("Methylphenidate")?.tier).toBe("narcotic");
  });

  it("matches case-insensitively and with a dose suffix", () => {
    expect(controlledSubstanceInfo("codeine 30mg")).not.toBeNull();
  });

  it("returns null for an ordinary, non-controlled drug", () => {
    expect(controlledSubstanceInfo("Amlodipine")).toBeNull();
    expect(controlledSubstanceInfo("Metformin")).toBeNull();
  });

  it("returns null for an empty or whitespace-only name", () => {
    expect(controlledSubstanceInfo("")).toBeNull();
    expect(controlledSubstanceInfo("   ")).toBeNull();
  });

  it("does not false-positive on a substring collision", () => {
    // "Codeine" must not match inside an unrelated word.
    expect(controlledSubstanceInfo("Encodeinate")).toBeNull();
  });
});

describe("brand names and combinations (OQ-276, CMO 2026-10-12)", () => {
  it.each([
    ["Tramal 50mg", "restricted"],
    ["Valium 5mg", "restricted"],
    ["Ativan", "restricted"],
    ["Xanax XR", "restricted"],
    ["Rivotril 0.5mg", "restricted"],
    ["Lexotan 3mg", "restricted"],
    ["Phensedyl syrup", "restricted"],
    ["Solpadeine Max", "restricted"],
    ["co-codamol 30/500", "restricted"],
    ["cocodamol", "restricted"],
    ["Ritalin LA", "narcotic"],
    ["Adderall", "narcotic"],
    ["Percocet 5/325", "narcotic"],
    ["OxyContin 10mg", "narcotic"],
  ])("flags %s as %s", (name, tier) => {
    expect(controlledSubstanceInfo(name)?.tier).toBe(tier);
  });

  it("flags phenobarbitone as well as phenobarbital (the older pattern matched only 'phenobarbitalone')", () => {
    expect(controlledSubstanceInfo("Phenobarbitone 30mg")?.tier).toBe("restricted");
    expect(controlledSubstanceInfo("Phenobarbital")?.tier).toBe("restricted");
  });

  it("does not flag ordinary medicines or look-alike words", () => {
    for (const name of ["Panadol Extra", "Paracetamol 500mg", "Ventolin", "Ultrasound gel", "Concertina", "Valiumx"]) {
      expect(controlledSubstanceInfo(name)).toBeNull();
    }
  });
});

describe("the list is data (OQ-484)", () => {
  const baseList: ControlledMedicineList = { version: 7, source: "database", terms: [{ term: "proofium", tier: "restricted", label: "Proof class" }] };

  it("a name on the list the caller passes is flagged, with that term's tier and label, and no code change", () => {
    expect(controlledSubstanceInfo("Proofium 5mg", baseList)).toMatchObject({ tier: "restricted", label: "Proof class" });
  });

  it("the same name is not flagged by the generated fallback, and a fallback name is not flagged by a list that does not carry it", () => {
    expect(controlledSubstanceInfo("Proofium 5mg")).toBeNull();
    expect(controlledSubstanceInfo("Morphine", baseList)).toBeNull();
  });

  it("an empty list flags nothing (the CMO retired every term): the database decides, not a hidden default", () => {
    expect(controlledSubstanceInfo("Morphine", { version: 9, source: "database", terms: [] })).toBeNull();
  });

  it("a name that matches both tiers gets the stricter advice", () => {
    const list: ControlledMedicineList = {
      version: 1,
      source: "database",
      terms: [
        { term: "alpha", tier: "restricted", label: "Lower" },
        { term: "beta", tier: "narcotic", label: "Higher" },
      ],
    };
    expect(controlledSubstanceInfo("alpha beta", list)?.tier).toBe("narcotic");
  });

  it("a multi-word term matches as a phrase, and a term can never act as a pattern", () => {
    const list: ControlledMedicineList = {
      version: 1,
      source: "database",
      terms: [
        { term: "proof phrase", tier: "restricted", label: "Phrase" },
        { term: "a.c", tier: "restricted", label: "Dot" },
      ],
    };
    expect(controlledSubstanceInfo("Proof Phrase 5mg", list)).not.toBeNull();
    expect(controlledSubstanceInfo("proofphrase", list)).toBeNull();
    expect(controlledSubstanceInfo("abc", list)).toBeNull();
    expect(controlledSubstanceInfo("a.c", list)).not.toBeNull();
  });
});

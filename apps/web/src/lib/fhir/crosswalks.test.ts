import {
  loincCodeableConceptForVitalType,
  splitCombinedBloodGroup,
  genotypeCodeableConcept,
  conditionCodeableConcept,
  vaccineCodeableConcept,
  cvxCodingForVaccineName,
  matchVaccineToCatalog,
  LOCAL_CODESYSTEMS,
} from "./crosswalks";

describe("loincCodeableConceptForVitalType", () => {
  it("attaches a LOINC coding for a known vital type", () => {
    const result = loincCodeableConceptForVitalType("weight", "Body weight");
    expect(result.coding?.[0]).toEqual({ system: "http://loinc.org", code: "29463-7", display: "Body weight" });
  });

  it("falls back to text-only for an unrecognised vital type rather than guessing", () => {
    const result = loincCodeableConceptForVitalType("not_a_real_type", "Mystery vital");
    expect(result.coding).toBeUndefined();
    expect(result.text).toBe("Mystery vital");
  });
});

describe("splitCombinedBloodGroup", () => {
  it("splits a combined ABO+Rh value", () => {
    expect(splitCombinedBloodGroup("O+")).toEqual({ abo: "O", rh: "Positive" });
    expect(splitCombinedBloodGroup("AB-")).toEqual({ abo: "AB", rh: "Negative" });
  });

  it("returns null for an unrecognised shape rather than a wrong split", () => {
    expect(splitCombinedBloodGroup("unknown")).toBeNull();
  });
});

describe("genotypeCodeableConcept", () => {
  it("codes the Nigeria-specific genotype value against the local CodeSystem, never a standard one", () => {
    const result = genotypeCodeableConcept("AS");
    expect(result.coding?.[0].system).toBe(LOCAL_CODESYSTEMS.haemoglobinGenotype);
    expect(result.coding?.[0].code).toBe("AS");
  });
});

describe("conditionCodeableConcept", () => {
  it("maps a known condition to its default ICD-10 code", () => {
    const result = conditionCodeableConcept("hypertension");
    expect(result.coding?.[0]).toMatchObject({ system: "http://hl7.org/fhir/sid/icd-10", code: "I10" });
  });

  it("covers every non-'other' care_plan_condition value with a code, and never guesses one for 'other'", () => {
    for (const condition of [
      "hypertension",
      "diabetes",
      "obesity",
      "ckd",
      "cardiovascular",
      "asthma",
      "copd",
      "heart_failure",
    ]) {
      expect(conditionCodeableConcept(condition).coding?.[0].system).toBe("http://hl7.org/fhir/sid/icd-10");
    }
    const other = conditionCodeableConcept("other");
    expect(other.coding?.[0].system).toBe(LOCAL_CODESYSTEMS.carePlanCondition);
  });
});

describe("cvxCodingForVaccineName / vaccineCodeableConcept", () => {
  it("matches common vaccine name variants", () => {
    expect(cvxCodingForVaccineName("BCG")?.code).toBe("19");
    expect(cvxCodingForVaccineName("Pentavalent (DTaP-Hib-IPV-HepB)")?.code).toBe("120");
    expect(cvxCodingForVaccineName("Yellow Fever")?.code).toBe("37");
  });

  it("returns text-only for an unrecognised vaccine name rather than a wrong CVX code", () => {
    const result = vaccineCodeableConcept("Some Locally-Named Booster");
    expect(result.coding).toBeUndefined();
    expect(result.text).toBe("Some Locally-Named Booster");
  });
});

describe("matchVaccineToCatalog", () => {
  const catalog = [
    { id: "1", name: "BCG" },
    { id: "2", name: "Yellow Fever" },
    { id: "3", name: "Pentavalent" },
  ];

  it("matches by incoming CVX code against the catalogue's own derivable code", () => {
    const match = matchVaccineToCatalog({ coding: [{ system: "http://hl7.org/fhir/sid/cvx", code: "37" }] }, catalog);
    expect(match?.id).toBe("2");
  });

  it("matches by exact text when no CVX code is present", () => {
    const match = matchVaccineToCatalog({ text: "BCG" }, catalog);
    expect(match?.id).toBe("1");
  });

  it("returns null rather than guessing when nothing matches confidently", () => {
    expect(matchVaccineToCatalog({ text: "Something entirely unrelated" }, catalog)).toBeNull();
    expect(matchVaccineToCatalog(undefined, catalog)).toBeNull();
  });
});

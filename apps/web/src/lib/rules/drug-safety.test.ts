import {
  assessMedicationSafety,
  assessAllergyFindings,
  classifyDrug,
  countBySeverity,
  type AllergyInput,
  type MedicationInput,
} from "./drug-safety";

let nextId = 0;
function med(drugName: string, extra: Partial<MedicationInput> = {}): MedicationInput {
  nextId += 1;
  return { id: `m${nextId}`, drugName, ...extra };
}

let nextAllergyId = 0;
function allergy(allergenText: string, extra: Partial<AllergyInput> = {}): AllergyInput {
  nextAllergyId += 1;
  return { id: `a${nextAllergyId}`, allergen: allergenText, ...extra };
}

describe("classifyDrug", () => {
  it("classifies by INN stem, so it generalises beyond the named drugs", () => {
    expect(classifyDrug("Lisinopril 10mg")).toContain("ace_inhibitor");
    expect(classifyDrug("Telmisartan")).toContain("arb");
    expect(classifyDrug("Bisoprolol fumarate")).toContain("beta_blocker");
    expect(classifyDrug("Atorvastatin 40mg nocte")).toContain("statin");
    expect(classifyDrug("Levofloxacin")).toContain("fluoroquinolone");
    // Not named anywhere in the pattern list — matched purely by stem.
    expect(classifyDrug("Zofenopril")).toContain("ace_inhibitor");
    expect(classifyDrug("Azilsartan")).toContain("arb");
  });

  it("returns EVERY class in a combination product", () => {
    // The single most important classification case: a fixed-dose combination
    // hides a whole class, which is exactly how a duplicate slips through.
    const combo = classifyDrug("Lisinopril/HCTZ 20/12.5");
    expect(combo).toContain("ace_inhibitor");
    expect(combo).toContain("thiazide_diuretic");

    const act = classifyDrug("Artemether-Lumefantrine");
    expect(act).toContain("antimalarial_act");
  });

  it("does not let a rate-limiting CCB fall through to the dihydropyridine class", () => {
    expect(classifyDrug("Verapamil SR")).toContain("ccb_non_dihydropyridine");
    expect(classifyDrug("Verapamil SR")).not.toContain("ccb_dihydropyridine");
    expect(classifyDrug("Amlodipine")).toContain("ccb_dihydropyridine");
  });

  it("does not classify spironolactone as a plain diuretic", () => {
    expect(classifyDrug("Spironolactone 25mg")).toContain("potassium_sparing_diuretic");
    expect(classifyDrug("Spironolactone 25mg")).not.toContain("thiazide_diuretic");
  });

  it("returns an empty list for an unrecognised or empty drug", () => {
    expect(classifyDrug("Paracetamol")).toEqual([]);
    expect(classifyDrug("")).toEqual([]);
    expect(classifyDrug("   ")).toEqual([]);
  });

  it("classifies penicillins and cephalosporins, including generic/allergen-style text", () => {
    expect(classifyDrug("Amoxicillin 500mg")).toContain("penicillin");
    expect(classifyDrug("Co-amoxiclav")).toContain("penicillin");
    expect(classifyDrug("Penicillin")).toContain("penicillin");
    expect(classifyDrug("Ceftriaxone 1g IV")).toContain("cephalosporin");
    expect(classifyDrug("Cephalosporin")).toContain("cephalosporin");
  });

  it("classifies generic/lay allergen terms a patient is likely to write", () => {
    expect(classifyDrug("Sulfa drugs")).toContain("cotrimoxazole");
    expect(classifyDrug("Sulfonamide")).toContain("cotrimoxazole");
    expect(classifyDrug("NSAIDs")).toContain("nsaid");
    expect(classifyDrug("Opioids")).toContain("tramadol_opioid");
    expect(classifyDrug("Statins")).toContain("statin");
  });
});

describe("interaction checking", () => {
  it("catches dual RAS blockade as contraindicated", () => {
    const report = assessMedicationSafety([med("Lisinopril"), med("Losartan")]);
    const finding = report.findings.find((f) => f.kind === "interaction");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("contraindicated");
    expect(finding!.title).toMatch(/renin-angiotensin/i);
    // The finding must name both drugs so the UI can point at the rows.
    expect(finding!.medicationIds).toHaveLength(2);
  });

  it("does NOT fire an interaction against a single combination product", () => {
    // One pill containing an ACE inhibitor and a thiazide is a deliberate
    // formulation, not two prescribers colliding. A naive class-pair check
    // would flag it and cry wolf on a completely standard prescription.
    const report = assessMedicationSafety([med("Lisinopril/HCTZ 20/12.5")]);
    expect(report.findings.filter((f) => f.kind === "interaction")).toHaveLength(0);
  });

  it("catches the NSAID + anticoagulant bleeding risk", () => {
    const report = assessMedicationSafety([med("Warfarin 5mg"), med("Ibuprofen 400mg")]);
    const finding = report.findings.find((f) => /bleeding/i.test(f.title));
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("contraindicated");
  });

  it("catches the statin + macrolide rhabdomyolysis risk", () => {
    const report = assessMedicationSafety([med("Simvastatin 40mg"), med("Clarithromycin 500mg")]);
    expect(report.findings.some((f) => /muscle toxicity/i.test(f.title))).toBe(true);
  });

  it("catches beta blocker + verapamil", () => {
    const report = assessMedicationSafety([med("Bisoprolol"), med("Verapamil")]);
    const finding = report.findings.find((f) => /bradycardia/i.test(f.title));
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("contraindicated");
  });

  it("catches additive QT prolongation between two common Nigerian antimicrobials", () => {
    const report = assessMedicationSafety([med("Ciprofloxacin"), med("Artemether-Lumefantrine")]);
    expect(report.findings.some((f) => /QT/i.test(f.title))).toBe(true);
  });

  it("stays quiet on a genuinely unremarkable pair", () => {
    const report = assessMedicationSafety([med("Amlodipine 5mg"), med("Atorvastatin 20mg")]);
    expect(report.findings.filter((f) => f.kind === "interaction")).toHaveLength(0);
  });
});

describe("duplicate therapy across prescribers", () => {
  it("flags two ACE inhibitors from different prescribers, naming both", () => {
    const report = assessMedicationSafety([
      med("Lisinopril 10mg", { prescriberName: "Dr Adeyemi" }),
      med("Ramipril 5mg", { prescriberName: "Dr Okonkwo" }),
    ]);
    const dup = report.findings.find((f) => f.kind === "duplicate_therapy");
    expect(dup).toBeDefined();
    expect(dup!.severity).toBe("contraindicated");
    expect(dup!.message).toContain("Dr Adeyemi");
    expect(dup!.message).toContain("Dr Okonkwo");
    expect(dup!.message).toMatch(/neither saw the other/i);
  });

  it("flags a duplicate that arrived by different routes even with no prescriber name", () => {
    // The real uncoordinated-care case: one added by a clinician here, one the
    // patient carried in from somewhere else.
    const report = assessMedicationSafety([
      med("Omeprazole 20mg", { source: "clinician" }),
      med("Esomeprazole 40mg", { source: "patient" }),
    ]);
    const dup = report.findings.find((f) => f.kind === "duplicate_therapy");
    expect(dup).toBeDefined();
    expect(dup!.message).toMatch(/different routes/i);
  });

  it("does NOT flag two insulins from the same prescriber — that is normal practice", () => {
    const report = assessMedicationSafety([
      med("Insulin glargine", { prescriberName: "Dr Adeyemi" }),
      med("Insulin aspart", { prescriberName: "Dr Adeyemi" }),
    ]);
    expect(report.findings.filter((f) => f.kind === "duplicate_therapy")).toHaveLength(0);
  });

  it("DOES flag two insulins when they came from different prescribers", () => {
    const report = assessMedicationSafety([
      med("Insulin glargine", { prescriberName: "Dr Adeyemi" }),
      med("Insulin detemir", { prescriberName: "Dr Okonkwo" }),
    ]);
    const dup = report.findings.find((f) => f.kind === "duplicate_therapy");
    expect(dup).toBeDefined();
    // Softer than a true duplicate — two insulins can legitimately coexist.
    expect(dup!.severity).toBe("caution");
  });

  it("does not flag a single combination product as a duplicate of itself", () => {
    const report = assessMedicationSafety([med("Amlodipine/Valsartan 5/80")]);
    expect(report.findings.filter((f) => f.kind === "duplicate_therapy")).toHaveLength(0);
  });
});

describe("renal dosing from the patient's own eGFR", () => {
  it("SKIPS every renal rule when no creatinine is on file, and says so", () => {
    // The critical negative case. An empty findings list with no explanation
    // would read as "renal dosing checked and fine" when nothing was checked.
    const report = assessMedicationSafety([med("Metformin 1g"), med("Ibuprofen")], {});
    expect(report.findings.filter((f) => f.kind === "renal_dosing")).toHaveLength(0);
    expect(report.renalCheckSkipped).toMatch(/no creatinine/i);
  });

  it("contraindicates metformin below eGFR 30", () => {
    const report = assessMedicationSafety([med("Metformin 1g")], { egfr: 24 });
    const renal = report.findings.find((f) => f.kind === "renal_dosing");
    expect(renal).toBeDefined();
    expect(renal!.severity).toBe("contraindicated");
    expect(report.renalCheckSkipped).toBeNull();
  });

  it("cautions rather than contraindicates metformin at eGFR 30-45", () => {
    const report = assessMedicationSafety([med("Metformin 1g")], { egfr: 38 });
    const renal = report.findings.filter((f) => f.kind === "renal_dosing");
    expect(renal).toHaveLength(1);
    expect(renal[0].severity).toBe("caution");
  });

  it("says nothing about metformin at a normal eGFR", () => {
    const report = assessMedicationSafety([med("Metformin 1g")], { egfr: 95 });
    expect(report.findings.filter((f) => f.kind === "renal_dosing")).toHaveLength(0);
  });

  it("picks the most severe applicable rule, not the first", () => {
    // At eGFR 20 both the <60 and <30 NSAID rules apply; the reader must get
    // the 'avoid' line, not the milder 'use with caution' one.
    const report = assessMedicationSafety([med("Diclofenac")], { egfr: 20 });
    const renal = report.findings.filter((f) => f.kind === "renal_dosing");
    expect(renal).toHaveLength(1);
    expect(renal[0].severity).toBe("contraindicated");
  });

  it("warns that a stale creatinine should be rechecked before acting on it", () => {
    const report = assessMedicationSafety([med("Metformin 1g")], { egfr: 24, egfrStale: true });
    const renal = report.findings.find((f) => f.kind === "renal_dosing")!;
    expect(renal.message).toMatch(/over a year old/i);
  });

  it("catches nitrofurantoin below eGFR 45, where it is both ineffective and toxic", () => {
    const report = assessMedicationSafety([med("Nitrofurantoin 100mg")], { egfr: 35 });
    const renal = report.findings.find((f) => f.kind === "renal_dosing")!;
    expect(renal.severity).toBe("contraindicated");
  });
});

describe("drug-specific rules", () => {
  it("caps simvastatin with amlodipine", () => {
    const report = assessMedicationSafety([med("Simvastatin 40mg"), med("Amlodipine 10mg")]);
    expect(report.findings.some((f) => /dose cap/i.test(f.title))).toBe(true);
  });

  it("singles out gemfibrozil rather than treating all fibrates alike", () => {
    const withGem = assessMedicationSafety([med("Gemfibrozil"), med("Atorvastatin")]);
    expect(
      withGem.findings.some((f) => f.severity === "contraindicated" && /gemfibrozil/i.test(f.title)),
    ).toBe(true);

    const withFeno = assessMedicationSafety([med("Fenofibrate"), med("Atorvastatin")]);
    expect(withFeno.findings.some((f) => /gemfibrozil/i.test(f.title))).toBe(false);
  });
});

describe("report shape", () => {
  it("ranks the most severe finding first", () => {
    const report = assessMedicationSafety(
      [med("Lisinopril"), med("Losartan"), med("Levothyroxine"), med("Omeprazole")],
      { egfr: 90 },
    );
    expect(report.findings.length).toBeGreaterThan(1);
    expect(report.findings[0].severity).toBe("contraindicated");
  });

  it("does not report the same finding twice from symmetric rules", () => {
    const report = assessMedicationSafety([med("Lisinopril"), med("Losartan")]);
    const titles = report.findings.filter((f) => f.kind === "interaction").map((f) => f.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("always marks itself advisory, so a clean report can never be read as 'safe'", () => {
    const report = assessMedicationSafety([med("Paracetamol")]);
    expect(report.findings).toHaveLength(0);
    expect(report.isAdvisoryOnly).toBe(true);
  });

  it("counts by severity for a badge", () => {
    const report = assessMedicationSafety([med("Lisinopril"), med("Losartan")]);
    const counts = countBySeverity(report);
    expect(counts.contraindicated).toBeGreaterThanOrEqual(1);
  });

  it("handles an empty medication list without throwing", () => {
    const report = assessMedicationSafety([]);
    expect(report.findings).toEqual([]);
  });
});

describe("allergy cross-checking", () => {
  it("flags an exact same-drug match as contraindicated", () => {
    const findings = assessAllergyFindings([med("Amoxicillin 500mg")], [allergy("Amoxicillin")]);
    const finding = findings.find((f) => f.kind === "allergy");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("contraindicated");
    expect(finding!.medicationIds).toEqual(expect.arrayContaining([expect.any(String)]));
  });

  it("catches a literal name match even when the allergen isn't in the class taxonomy", () => {
    // "Augmentin" the brand name vs a prescription also literally called Augmentin —
    // this exercises the substring fallback, not classifyDrug's penicillin pattern.
    const findings = assessAllergyFindings([med("Augmentin 625mg BD")], [allergy("Augmentin")]);
    expect(findings.some((f) => f.severity === "contraindicated")).toBe(true);
  });

  it("flags a same-class match (different specific drug) as contraindicated for a tight class", () => {
    const findings = assessAllergyFindings([med("Lisinopril 10mg")], [allergy("Ramipril", { reaction: "cough" })]);
    const finding = findings.find((f) => f.kind === "allergy");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("contraindicated");
    expect(finding!.title).toMatch(/ramipril/i);
  });

  it("downgrades a same-class match to caution for a coarse/bundled class (aspirin vs clopidogrel)", () => {
    // Aspirin and clopidogrel share the "antiplatelet" interaction class but are
    // chemically unrelated — an aspirin allergy should not read as a hard block
    // on clopidogrel.
    const findings = assessAllergyFindings([med("Clopidogrel 75mg")], [allergy("Aspirin")]);
    const finding = findings.find((f) => f.kind === "allergy");
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe("caution");
  });

  it("stays quiet when there is no relationship at all", () => {
    const findings = assessAllergyFindings([med("Paracetamol")], [allergy("Penicillin")]);
    expect(findings).toHaveLength(0);
  });

  it("returns nothing for an empty allergy list or an empty medication list", () => {
    expect(assessAllergyFindings([med("Amoxicillin")], [])).toHaveLength(0);
    expect(assessAllergyFindings([], [allergy("Penicillin")])).toHaveLength(0);
  });

  describe("penicillin / cephalosporin cross-reactivity", () => {
    it("cautions on a mild penicillin allergy against a cephalosporin", () => {
      const findings = assessAllergyFindings(
        [med("Cefuroxime 500mg")],
        [allergy("Penicillin", { severity: "mild", reaction: "mild rash" })],
      );
      const finding = findings.find((f) => /cross-reactivity/i.test(f.title));
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe("caution");
    });

    it("escalates to contraindicated after a severe/anaphylactic penicillin reaction", () => {
      const findings = assessAllergyFindings(
        [med("Cefuroxime 500mg")],
        [allergy("Penicillin", { severity: "severe", reaction: "anaphylaxis" })],
      );
      const finding = findings.find((f) => /cross-reactivity/i.test(f.title));
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe("contraindicated");
    });

    it("does not double-flag when the allergen and drug are already an exact class match", () => {
      // Amoxicillin allergy vs Amoxicillin prescription: exact match already fires;
      // the penicillin/cephalosporin cross-reactivity rule should not also fire
      // (there's no cephalosporin in this list to cross-react with anyway).
      const findings = assessAllergyFindings([med("Amoxicillin")], [allergy("Amoxicillin")]);
      expect(findings.filter((f) => /cross-reactivity/i.test(f.title))).toHaveLength(0);
    });
  });

  describe("ACE inhibitor / ARB — reaction-aware", () => {
    it("does NOT warn when the recorded reaction is just the class-effect cough — that's the standard switch", () => {
      const findings = assessAllergyFindings(
        [med("Losartan 50mg")],
        [allergy("Lisinopril", { reaction: "dry cough" })],
      );
      const caution = findings.find((f) => f.severity === "caution" || f.severity === "contraindicated");
      expect(caution).toBeUndefined();
      // Still says something useful, just at info level, not a warning.
      expect(findings.some((f) => f.severity === "info")).toBe(true);
    });

    it("cautions when the reaction was angioedema", () => {
      const findings = assessAllergyFindings(
        [med("Losartan 50mg")],
        [allergy("Lisinopril", { reaction: "facial angioedema" })],
      );
      const finding = findings.find((f) => f.kind === "allergy");
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe("caution");
    });

    it("gives a lower-confidence prompt to confirm when the reaction is unrecorded", () => {
      const findings = assessAllergyFindings([med("Losartan 50mg")], [allergy("Lisinopril")]);
      const finding = findings.find((f) => f.kind === "allergy");
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe("info");
      expect(finding!.message).toMatch(/confirm/i);
    });
  });

  describe("aspirin / NSAID cross-reactivity", () => {
    it("cautions on an aspirin allergy against a different NSAID", () => {
      const findings = assessAllergyFindings([med("Ibuprofen 400mg")], [allergy("Aspirin")]);
      const finding = findings.find((f) => f.kind === "allergy");
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe("caution");
    });

    it("cautions the other direction too — an NSAID allergy against aspirin specifically", () => {
      const findings = assessAllergyFindings([med("Aspirin 75mg")], [allergy("Ibuprofen")]);
      const finding = findings.find((f) => f.kind === "allergy");
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe("caution");
    });

    it("does not fire this rule for clopidogrel — it is not an NSAID", () => {
      const findings = assessAllergyFindings([med("Clopidogrel 75mg")], [allergy("Ibuprofen")]);
      expect(findings.filter((f) => /nsaids and aspirin/i.test(f.title))).toHaveLength(0);
    });
  });

  describe("sulfonamide allergy — corrective note, not a warning", () => {
    it("flags co-trimoxazole itself as a direct class match", () => {
      const findings = assessAllergyFindings([med("Septrin")], [allergy("Sulfa drugs")]);
      const finding = findings.find((f) => f.kind === "allergy" && !/does not extend/i.test(f.title));
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe("contraindicated");
    });

    it("gives an info-level corrective note for furosemide, not a caution/block", () => {
      const findings = assessAllergyFindings([med("Furosemide 40mg")], [allergy("Sulfa drugs")]);
      const finding = findings.find((f) => f.kind === "allergy");
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe("info");
      expect(finding!.title).toMatch(/does not extend/i);
    });

    it("gives the same corrective note for a sulfonylurea and for celecoxib", () => {
      const sulfonylurea = assessAllergyFindings([med("Gliclazide 80mg")], [allergy("Sulfonamide")]);
      expect(sulfonylurea.find((f) => f.kind === "allergy")?.severity).toBe("info");

      const celecoxib = assessAllergyFindings([med("Celecoxib 200mg")], [allergy("Sulfonamide")]);
      expect(celecoxib.find((f) => f.kind === "allergy")?.severity).toBe("info");
    });
  });

  describe("integrated into assessMedicationSafety", () => {
    it("says allergies were not checked when the caller never loads them", () => {
      const report = assessMedicationSafety([med("Amoxicillin")]);
      expect(report.allergyCheckNote).toMatch(/not checked/i);
    });

    it("says none are recorded when the caller loads an empty list", () => {
      const report = assessMedicationSafety([med("Amoxicillin")], { allergies: [] });
      expect(report.allergyCheckNote).toMatch(/no allergies are recorded/i);
    });

    it("clears the note and surfaces the finding when a real allergy is loaded", () => {
      const report = assessMedicationSafety([med("Amoxicillin 500mg")], {
        allergies: [allergy("Penicillin", { severity: "severe" })],
      });
      expect(report.allergyCheckNote).toBeNull();
      const finding = report.findings.find((f) => f.kind === "allergy");
      expect(finding).toBeDefined();
      expect(finding!.severity).toBe("contraindicated");
    });

    it("ranks a contraindicated allergy hit above a milder interaction", () => {
      const report = assessMedicationSafety(
        [med("Amoxicillin 500mg"), med("Levothyroxine"), med("Omeprazole")],
        { allergies: [allergy("Penicillin", { severity: "severe" })] },
      );
      expect(report.findings[0].kind).toBe("allergy");
      expect(report.findings[0].severity).toBe("contraindicated");
    });
  });
});

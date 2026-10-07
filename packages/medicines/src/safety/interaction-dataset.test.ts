import { describe, expect, it } from "@jest/globals";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDataset, canonicalDatasetText, DATASET_VERSION, INTERACTION_DATASET_HASH } from "./interaction-dataset";
import { assessMedicationSafety } from "./drug-safety";

const SEED = join(process.cwd(), "..", "..", "docs", "clinical", "interaction-dataset-v1.seed.json");

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("interaction dataset v1 (D6: prepared for a human to sign, never signed here)", () => {
  const rules = buildDataset();
  const hash = sha256(canonicalDatasetText(rules));
  const doc = { version: DATASET_VERSION, status: "draft", content_hash: hash, rule_count: rules.length, rules };

  if (process.env.WRITE_DATASET === "1") {
    writeFileSync(SEED, JSON.stringify(doc, null, 2) + "\n");
  }

  it("has unique rule codes, a source and an advice key on every row", () => {
    expect(new Set(rules.map((r) => r.rule_code)).size).toBe(rules.length);
    for (const r of rules) {
      expect(r.source.length).toBeGreaterThan(20);
      expect(r.advice_key).toMatch(/^medicines\.addcheck\.advice\./);
      expect(r.title).not.toContain("|");
      expect(r.source).not.toContain("|");
    }
  });

  it("the checked-in seed file is exactly what the code runs (a changed rule needs a new version and a new sign-off)", () => {
    expect(existsSync(SEED)).toBe(true);
    const onDisk = JSON.parse(readFileSync(SEED, "utf8")) as typeof doc;
    expect(onDisk.status).toBe("draft");
    expect(onDisk.content_hash).toBe(hash);
    expect(onDisk.rules).toEqual(rules);
  });

  it("the hash constant the app compares with the signed row is exactly the hash of these rules", () => {
    expect(INTERACTION_DATASET_HASH).toBe(hash);
  });

  it("never carries an approval: the seed is a draft with no signer", () => {
    const onDisk = JSON.parse(readFileSync(SEED, "utf8")) as Record<string, unknown>;
    expect(onDisk).not.toHaveProperty("signed_by");
    expect(onDisk).not.toHaveProperty("signed_at");
    expect(onDisk.status).toBe("draft");
  });

  it("every interaction row is actually reached by the engine (no dead rows in the signed list)", () => {
    // One medicine per class from a known name; each interaction row must fire when both classes are present.
    const sample: Record<string, string> = {
      ace_inhibitor: "lisinopril", arb: "losartan", beta_blocker: "atenolol", ccb_dihydropyridine: "amlodipine",
      ccb_non_dihydropyridine: "verapamil", thiazide_diuretic: "hydrochlorothiazide", loop_diuretic: "furosemide",
      potassium_sparing_diuretic: "spironolactone", potassium_supplement: "potassium chloride", statin: "atorvastatin",
      fibrate: "fenofibrate", nsaid: "ibuprofen", anticoagulant: "warfarin", antiplatelet: "clopidogrel", ssri: "sertraline",
      tramadol_opioid: "tramadol", macrolide: "clarithromycin", fluoroquinolone: "ciprofloxacin", azole_antifungal: "fluconazole",
      nitroimidazole: "metronidazole", digoxin: "digoxin", levothyroxine: "levothyroxine", metformin: "metformin",
      sulfonylurea: "gliclazide", ppi: "omeprazole", allopurinol: "allopurinol", colchicine: "colchicine",
      methotrexate: "methotrexate", cotrimoxazole: "cotrimoxazole", lithium: "lithium", amiodarone: "amiodarone",
      antipsychotic: "haloperidol", calcium_or_iron_supplement: "ferrous sulfate", penicillin: "amoxicillin",
      aminoglycoside: "gentamicin", sglt2: "empagliflozin", dpp4: "sitagliptin", insulin: "insulin glargine",
      nitrofurantoin: "nitrofurantoin", gabapentinoid: "gabapentin", cephalosporin: "cefuroxime", antimalarial_act: "artemether",
    };
    for (const r of rules.filter((x) => x.kind === "interaction")) {
      const a = sample[r.drug_a];
      const b = sample[r.drug_b];
      expect(a && b).toBeTruthy();
      const report = assessMedicationSafety([
        { id: "a", drugName: a },
        { id: "b", drugName: b },
      ]);
      expect(report.findings.some((f) => f.kind === "interaction" && f.title === r.title)).toBe(true);
    }
  });
});

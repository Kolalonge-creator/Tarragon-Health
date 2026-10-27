import { describe, expect, it } from "@jest/globals";
import { S59D_DRAFT_VOCABULARY } from "@tarragon/symptom-triage-engine";
import { t, type MessageKey } from "@tarragon/i18n";

describe("the S59d draft pathways have patient wording ready before anyone signs them", () => {
  it("every symptom, trigger and history key has a label in the catalogue", () => {
    const missing = S59D_DRAFT_VOCABULARY.filter((k) => (t(`symptom.opt.${k}` as MessageKey) as string) === `symptom.opt.${k}`);
    expect(missing).toEqual([]);
  });

  it("no label is empty, uses a dash as punctuation, or names a diagnosis", () => {
    for (const k of S59D_DRAFT_VOCABULARY) {
      const label = t(`symptom.opt.${k}` as MessageKey) as string;
      expect(label.trim().length).toBeGreaterThan(2);
      expect(label).not.toMatch(/[–—]/);
      expect(label).not.toMatch(/\b(malaria|typhoid|dka|ketoacidosis|pre-?eclampsia|eclampsia|stroke|hypoglyc|hyperglyc|sepsis)\b/i);
    }
  });
});

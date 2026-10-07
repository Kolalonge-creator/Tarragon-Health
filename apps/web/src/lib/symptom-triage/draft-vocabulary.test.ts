import { describe, expect, it } from "@jest/globals";
import { PAEDIATRIC_DRAFT_VOCABULARY } from "@tarragon/symptom-triage-engine";
import { t, type MessageKey } from "@tarragon/i18n";

describe("the paediatric draft pathways have patient wording ready before anyone signs them", () => {
  it("every symptom, trigger and history key has a label in the catalogue", () => {
    const missing = PAEDIATRIC_DRAFT_VOCABULARY.filter((k) => (t(`symptom.opt.${k}` as MessageKey) as string) === `symptom.opt.${k}`);
    expect(missing).toEqual([]);
  });
});

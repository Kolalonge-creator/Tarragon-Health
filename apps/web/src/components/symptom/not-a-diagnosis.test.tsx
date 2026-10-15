import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { t } from "@tarragon/i18n";
import { NotADiagnosis } from "./not-a-diagnosis";

const SRC = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

/** Every screen that shows a symptom check result or review (spec 12.9). Add a new one here the day it exists. */
const RESULT_SURFACES = [
  "app/(dashboard)/patient/symptom-triage-check.tsx",
  "components/symptom/symptom-reviews-page.tsx",
];

describe("the shared 'not a diagnosis' label (S60, spec 12.9)", () => {
  it("renders the catalogue words, in both sizes, as a note", () => {
    const full = renderToStaticMarkup(<NotADiagnosis />);
    const short = renderToStaticMarkup(<NotADiagnosis variant="short" />);
    expect(full).toContain(t("symptom.not_a_diagnosis.full"));
    expect(short).toContain(t("symptom.not_a_diagnosis.short"));
    expect(full).toContain('role="note"');
  });

  it("says possible causes and the care team, never the banned words", () => {
    for (const k of ["symptom.not_a_diagnosis.full", "symptom.not_a_diagnosis.short"] as const) {
      const s = t(k);
      expect(s).toMatch(/not a diagnosis/i);
      expect(s).toMatch(/care team/i);
      expect(s).not.toMatch(/your doctor|cure|instant doctor/i);
      expect(s).not.toContain("—");
    }
  });

  it.each(RESULT_SURFACES)("%s uses the shared component and does not hard-code the sentence", (file) => {
    const src = read(file);
    expect(src).toContain("NotADiagnosis");
    expect(src).toMatch(/<NotADiagnosis/);
    expect(src).not.toMatch(/not a diagnosis/i);
  });

  it("no other symptom surface in the web app repeats the sentence either (one component, one catalogue entry)", () => {
    const importers = [
      "app/(dashboard)/patient/symptom-triage-check.tsx",
      "app/(dashboard)/patient/symptom-triage-actions.ts",
      "lib/symptom-triage/safety-net-copy.ts",
      "components/symptom/symptom-safety-page.tsx",
    ];
    for (const f of importers) expect([f, /not a diagnosis/i.test(read(f))]).toEqual([f, false]);
  });
});

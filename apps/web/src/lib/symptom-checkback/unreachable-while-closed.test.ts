import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * S59c, INV-14 (app side): everything the assessment experience adds is unreachable while the symptom checker guard is OFF. The database
 * refuses as well (proof s59c_assessment_ux.sql); this scan pins the app half so a screen cannot be added that skips the check, and it
 * pins the privacy rules of the new components (no storage, no network, no logging of anything typed).
 */
const SRC = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

describe("closed means closed (app side)", () => {
  it("the follow-up page checks the guard before it reads anything", () => {
    const page = read("app/(dashboard)/patient/symptom-checkback/[id]/page.tsx");
    expect(page).toContain("isSymptomCheckerOpen");
    expect(page.indexOf("isSymptomCheckerOpen(")).toBeLessThan(page.indexOf("readCheckbackView("));
  });

  it("answering checks the guard before it asks the database anything", () => {
    const answer = read("lib/symptom-checkback/answer.ts");
    expect(answer.indexOf("isSymptomCheckerOpen(")).toBeGreaterThan(-1);
    expect(answer.indexOf("isSymptomCheckerOpen(")).toBeLessThan(answer.indexOf('"answer_symptom_checkback"'));
  });

  it("the describe box, the explainer and the save card only exist inside the wizard, after its closed-state early return", () => {
    const wizard = read("app/(dashboard)/patient/symptom-triage-check.tsx");
    const early = wizard.indexOf("presentingComplaints.length === 0");
    expect(early).toBeGreaterThan(-1);
    for (const marker of ["<DescribeEntry", "<WhyThisResult", "<SaveCardPanel", "<SafetyNetBlock"]) {
      expect(wizard.indexOf(marker)).toBeGreaterThan(early);
    }
  });

  it("an unsigned synonym table leaves the checker exactly as it was: the describe box is only rendered when a table is in force (web and phone)", () => {
    expect(read("app/(dashboard)/patient/symptom-triage-check.tsx")).toMatch(/\{ux\.describe && \(\s*<DescribeEntry/);
    const phone = readFileSync(join(__dirname, "..", "..", "..", "..", "mobile", "src", "screens", "sections", "symptom-checker-card.tsx"), "utf8");
    expect(phone).toMatch(/\{ux\.describe && <DescribeBox/);
  });

  it("the follow-up banner is only rendered while the checker is open, and only for the person's own account", () => {
    const page = read("app/(dashboard)/patient/(sections)/vitals/page.tsx");
    expect(page).toMatch(/presentingComplaints\.length > 0 && subjectId === profile\.id \? <SymptomCheckbackBanner/);
  });

  it("the mobile route for the follow-up checks the guard too", () => {
    const route = read("app/api/mobile/symptom-checkback/route.ts");
    expect(route).toContain("isSymptomCheckerOpen");
  });
});

describe("privacy of the new components", () => {
  for (const f of ["components/symptom/describe-entry.tsx", "components/symptom/save-card.tsx", "components/symptom/safety-net-block.tsx", "components/symptom/why-this-result.tsx"]) {
    it(`${f} keeps nothing: no storage, cookie, URL state, network or log`, () => {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|history\.(push|replace)State|useSearchParams|router\.(push|replace)/);
      expect(code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|console\.|Sentry|analytics|posthog|track\(/i);
    });
  }

  it("the describe box never hands the typed text to anything but the matcher", () => {
    const code = read("components/symptom/describe-entry.tsx");
    // the only prop callbacks carry a pathway key or a boolean, never the text
    expect(code).toMatch(/onChoose: \(complaintKey: string\) => void/);
    expect(code).toMatch(/onDanger: \(selfHarm: boolean\) => void/);
  });
});

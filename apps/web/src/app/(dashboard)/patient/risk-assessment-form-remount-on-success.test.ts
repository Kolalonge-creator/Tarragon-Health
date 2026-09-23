import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";

/**
 * Regression test for a bug three independent /code-review angles
 * converged on: this form's `useRemountOnActionResult` used to remount
 * only on error (`shouldRemount = (s) => Boolean(s?.error)`), on the
 * theory that a multi-step wizard staying mounted through a success (so
 * the patient can keep reviewing/editing) meant it didn't need to remount
 * there too. That missed the hook's own documented behavior: React resets
 * every uncontrolled field in an action-bound <form> at *submit* time -
 * success included - regardless of whether anything ever remounts
 * afterward. With no post-success remount to reapply fresh
 * defaultValue/defaultChecked props from the echoed `values` (also fixed
 * in this same pass to actually be returned on success - see
 * actions.ts's submitRiskAssessment), a patient who successfully saved
 * the whole 4-step wizard saw every one of their ~15 answers visibly wiped
 * to blank/unchecked the instant "Save assessment" was clicked, even
 * though the save itself worked and the server already had the correct
 * data.
 *
 * This reads the source rather than driving a real submission through the
 * DOM: confirmed directly (via a deliberate sabotage-and-rerun) that jsdom
 * does not reproduce React's native submit-time form-reset in this
 * environment, so a DOM-interaction test literally cannot fail regardless
 * of whether this fix is present - see risk-assessment-form.test.tsx's own
 * "keeps a field's value visible..." test, which is a real smoke test for
 * remount+echo working correctly but, on its own, is not a valid regression
 * guard for this specific bug. Comments are stripped first so this file's
 * own explanatory prose doesn't trip the assertions.
 */
function copyOf(...segments: string[]): string {
  const source = readFileSync(join(__dirname, ...segments), "utf8");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments, JSDoc included
    .replace(/^\s*\/\/.*$/gm, " "); // whole-line comments
}

const RISK_ASSESSMENT_FORM = copyOf("risk-assessment-form.tsx");
const ACTIONS = copyOf("actions.ts");

describe("risk-assessment-form — remounts on success as well as error", () => {
  it("does not gate the remount to error-only", () => {
    expect(RISK_ASSESSMENT_FORM).not.toMatch(
      /useRemountOnActionResult\(\s*state,\s*\(s\)\s*=>\s*Boolean\(s\?\.error\)/
    );
  });

  it("remounts (and moves focus) on any action result, success included", () => {
    expect(RISK_ASSESSMENT_FORM).toMatch(
      /useRemountOnActionResult\(\s*state,\s*\(s\)\s*=>\s*Boolean\(s\),\s*state\?\.success\s*\?\s*successId\s*:\s*errorId\s*\)/
    );
  });
});

describe("submitRiskAssessment — echoes values on success too, not just on failure", () => {
  it("does not return a bare { success: true } on its success path", () => {
    // The failure branches all echo `, values`; the one success return
    // that used to omit it is the last `return { success: true };` before
    // the function's closing brace, right after the vaccination-schedule
    // generation call.
    expect(ACTIONS).not.toMatch(
      /generateVaccinationScheduleBestEffort\(\{[\s\S]{0,200}\}\);\s*return \{ success: true \};/
    );
  });

  it("echoes the submitted values alongside success", () => {
    expect(ACTIONS).toMatch(
      /generateVaccinationScheduleBestEffort\(\{[\s\S]{0,200}\}\);\s*return \{ success: true, values \};/
    );
  });
});

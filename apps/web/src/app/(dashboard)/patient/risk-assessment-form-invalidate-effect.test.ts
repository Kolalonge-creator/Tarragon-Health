import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";

/**
 * Regression test for a bug caught by review: the success-side effect that
 * invalidates the "risk-assessment-responses"/"prevention-risk-scores"
 * React Query caches depended on the derived `state?.success` boolean
 * instead of `state` itself. Two consecutive successful submissions both
 * have `success: true` - the same primitive, on two different `state`
 * objects returned by `useActionState` - so a dependency array keyed on
 * that boolean doesn't change between them and React skips re-running the
 * effect on the second submission, leaving the care-plan preview/risk
 * tiles showing stale pre-update data after a patient edits an answer and
 * saves again in the same session. The exact same bug pattern, same fix,
 * as patient-location-form.tsx's router.refresh() effect (see that file's
 * own comment and update-patient-location.test.ts).
 *
 * This reads the source rather than driving two real submissions through
 * the DOM: confirmed directly (see risk-assessment-form.test.tsx's own
 * note) that a second `fireEvent.click`/`fireEvent.submit` on this form's
 * already-submitted-once `<form action={formAction}>` element never
 * re-invokes the mocked server action in this jsdom/React 19 setup - this
 * component deliberately does NOT remount its `<form>` on success (only on
 * error, see `useRemountOnActionResult`'s `shouldRemount` in the same
 * file), which is what patient-location-form.tsx's own DOM-driven test
 * relies on being able to re-arm the dispatch on every submission. Comments
 * are stripped first so this file's own explanatory prose doesn't trip the
 * assertions.
 */
function copyOf(...segments: string[]): string {
  const source = readFileSync(join(__dirname, ...segments), "utf8");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments, JSDoc included
    .replace(/^\s*\/\/.*$/gm, " "); // whole-line comments
}

const RISK_ASSESSMENT_FORM = copyOf("risk-assessment-form.tsx");

describe("risk-assessment-form — query-invalidation effect dependency", () => {
  it("does not key the invalidation effect on the derived state?.success boolean", () => {
    expect(RISK_ASSESSMENT_FORM).not.toMatch(
      /invalidateQueries\(\{\s*queryKey:\s*\["risk-assessment-responses"[\s\S]{0,400}\},\s*\[state\?\.success,/
    );
  });

  it("keys it on state itself, so a second consecutive success (same primitive, new object) still refires it", () => {
    expect(RISK_ASSESSMENT_FORM).toMatch(
      /invalidateQueries\(\{\s*queryKey:\s*\["risk-assessment-responses"[\s\S]{0,400}\},\s*\[state,\s*queryClient,\s*patientId\]\);/
    );
  });
});

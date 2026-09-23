import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression test for the drift class packages/shared/src/specialist-type-options.ts
 * exists to stop: six independent call sites each hand-copied the
 * specialist_type enum and drifted out of sync with it in a different way
 * as it grew (missing psychiatry, psychology, and/or genitourinary_medicine
 * -- see that module's own header comment and the "Consolidate specialist_type
 * enum lists into a single shared source" commit that fixed it). That
 * module's own test only asserts the shared list is complete; it doesn't
 * prove any given file actually imports from it. This scans every known
 * apps/web call site so a future edit can't quietly reintroduce a local,
 * re-driftable list without failing here first.
 */
const CALL_SITES = [
  "src/app/(dashboard)/clinician/patients/[patientId]/create-referral-form.tsx",
  "src/app/(dashboard)/admin/settings/clinical-staff/clinical-staff-manager.tsx",
  "src/app/(dashboard)/admin/settings/partners/specialists/specialists-manager.tsx",
  "src/app/(dashboard)/clinician/patients/[patientId]/consultation-follow-ups-panel.tsx",
  "src/app/(dashboard)/patient/find-a-specialist/find-a-specialist.tsx",
];

describe("specialist_type call sites stay on the shared source", () => {
  it.each(CALL_SITES)("%s imports the shared specialist_type list rather than hand-rolling one", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");

    expect(source).toMatch(/from\s+["']@tarragon\/shared["']/);
    // At least one of the shared exports this module offers for a picker/label lookup.
    expect(source).toMatch(/\bSPECIALIST_TYPE(S|_OPTIONS|_LABEL|_VALUES)\b/);
    // The exact shape every drifted call site had before the shared module
    // existed: a locally declared `SPECIALIST_TYPE...` array/record, rather
    // than an imported one.
    expect(source).not.toMatch(/\bconst\s+SPECIALIST_TYPE\w*\s*[:=]/);
  });
});

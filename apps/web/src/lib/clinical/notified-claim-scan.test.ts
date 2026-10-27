/**
 * W-53 scan: a patient-facing "has been notified" claim must sit behind the doctor_review gate (D-03, Trust Charter). A new ungated claim
 * fails this test. Each baselined file is either staff/admin-facing, or backed by a DB trigger that really raises a clinician alert on
 * every plan (verified 2026-10-27), or is mobile (owned by #1309 and migrated there). Never widen the baseline silently.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "../../../../..");
const CLAIM = /(?:has|have) been notified/gi;
const GATE = /patientHasDoctorReview|flaggedReadingMessage|doctorReview/;

/** file (relative to repo root) -> exact number of claims allowed, with the reason. */
const BASELINE: Record<string, [number, string]> = {
  "apps/web/src/app/(dashboard)/clinician/patients/[patientId]/request-emergency-access-panel.tsx": [1, "clinician-facing"],
  "apps/web/src/app/(dashboard)/admin/settings/ai-governance/actions.ts": [1, "admin-facing"],
  "apps/web/src/app/(dashboard)/lab-partner/lab-partner-worklist.tsx": [1, "lab staff-facing"],
  "apps/web/src/app/(dashboard)/patient/breast-symptom-card.tsx": [1, "breast_symptom_reports_raise_alert trigger raises a clinician_review alert on every insert"],
  "apps/web/src/app/(dashboard)/patient/hospital-admissions-card.tsx": [1, "patient_hospital_admissions_raise_alert trigger raises an alert on every insert"],
  "apps/web/src/app/(dashboard)/patient/sexual-health/emergency-contraception-card.tsx": [1, "ec_requests_raise_alert trigger raises a 1-hour alert on every insert"],
  "apps/web/src/lib/notifications/describe-in-app.ts": [1, "vitals_monitoring_escalated is only written by the escalation job; open question for the CMO"],
  "apps/mobile/src/screens/sections/womens-health-screen.tsx": [1, "mobile, #1309 / W-53 mobile follow-up; same alert-backed trigger as the web breast card"],
  "apps/mobile/src/screens/sections/sexual-health-screen.tsx": [1, "mobile, #1309 / W-53 mobile follow-up; same alert-backed trigger as the web EC card"],
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.|\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

describe("ungated 'has been notified' claims (W-53)", () => {
  const found = new Map<string, { n: number; gated: boolean }>();
  for (const f of [...walk(join(ROOT, "apps/web/src")), ...walk(join(ROOT, "apps/mobile/src"))]) {
    const src = readFileSync(f, "utf8");
    const n = (src.match(CLAIM) ?? []).length;
    if (n > 0) found.set(relative(ROOT, f), { n, gated: GATE.test(src) });
  }

  it("every file with a claim is gated on doctor review or baselined with a reason and an exact count", () => {
    const bad: string[] = [];
    for (const [file, { n, gated }] of found) {
      if (gated) continue;
      const base = BASELINE[file];
      if (!base) bad.push(`${file}: ${n} ungated claim(s), not baselined`);
      else if (n !== base[0]) bad.push(`${file}: ${n} claims, baseline says ${base[0]}`);
    }
    expect(bad).toEqual([]);
  });

  it("the baseline has no stale entries", () => {
    const stale = Object.keys(BASELINE).filter((f) => !found.has(f) || found.get(f)!.gated);
    expect(stale).toEqual([]);
  });

  it("the two lifestyle logging sites are gated", () => {
    for (const f of ["apps/web/src/app/(dashboard)/patient/lifestyle/actions.ts", "apps/web/src/app/api/mobile/lifestyle/log/route.ts"]) {
      expect(readFileSync(join(ROOT, f), "utf8")).toMatch(/patientHasDoctorReview/);
    }
  });
});

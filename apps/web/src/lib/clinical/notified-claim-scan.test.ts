/**
 * W-53 scan: a patient-facing claim that the care team or a doctor is involved ("has been notified", "a doctor will be in touch", "has been
 * alerted", "we have alerted", "will follow up with you") must sit behind the doctor-review gate (D-03, Trust Charter). A new ungated claim
 * fails this test.
 *
 * Gate detection is PER CLAIM: the gate (`doctorReview`, `useDoctorReview`, `patientHasDoctorReview`, `flaggedReadingMessage`) must appear within
 * GATE_WINDOW lines of the claim (the same function or component), or the claim line carries a `// doctor-review-gated` annotation AND its file
 * references the gate somewhere. Anything else must be in BASELINE with an exact count and a reason. Never widen the baseline silently.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "../../../../..");
const SCAN_ROOTS = ["apps/web/src", "apps/mobile/src", "packages/i18n/src", "supabase/functions"];
const CLAIMS = [
  /(?:has|have) been notified/i,
  /a doctor will be in touch/i,
  /(?<!not )(?<!No doctor )has been alerted/i,
  /we have alerted/i,
  /will follow up with you/i,
];
const GATE = /doctorReview|useDoctorReview|patientHasDoctorReview|flaggedReadingMessage/;
const GATE_WINDOW = 25;
const ANNOTATION = "doctor-review-gated";

/** file (relative to repo root) -> exact number of ungated claim lines allowed, with the reason. */
const BASELINE: Record<string, [number, string]> = {
  "apps/web/src/app/(dashboard)/clinician/patients/[patientId]/request-emergency-access-panel.tsx": [1, "clinician-facing"],
  "apps/web/src/app/(dashboard)/admin/settings/ai-governance/actions.ts": [1, "admin-facing"],
  "apps/web/src/app/(dashboard)/lab-partner/lab-partner-worklist.tsx": [1, "lab staff-facing"],
  "apps/web/src/lib/notifications/describe-in-app.ts": [1, "vitals_monitoring_escalated is only written by the escalation job; open question for the CMO"],
  "apps/web/src/app/(dashboard)/patient/emergency-alert.tsx": [1, "says the emergency CONTACT was alerted, not a doctor"],
  "apps/web/src/lib/rota/actions.ts": [1, "clinician-facing rota message"],
  "packages/i18n/src/en.ts": [3, "pathway.dm_red / dm_dka / as_red bodies say 'care team has been alerted' to any plan: found 2026-10-27, needs a CMO decision (gate or reword); not changed here"],
  "supabase/functions/send-pending-notifications/templates.ts": [1, "SMS check-in template (itself conflicts with the SMS-for-codes-only rule; W-59 / founder decision)"],
  "apps/mobile/src/screens/sections/womens-health-screen.tsx": [1, "mobile, owned by #1309 / W-53 mobile follow-up"],
  "apps/mobile/src/screens/sections/sexual-health-screen.tsx": [1, "mobile, owned by #1309 / W-53 mobile follow-up"],
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

interface Found {
  file: string;
  line: number;
  text: string;
  gated: boolean;
  annotated: boolean;
  annotatedButFileHasNoGate: boolean;
}

function scan(): Found[] {
  const out: Found[] = [];
  for (const root of SCAN_ROOTS) {
    for (const f of walk(join(ROOT, root))) {
      const lines = readFileSync(f, "utf8").split("\n");
      const fileHasGate = lines.some((l) => GATE.test(l));
      lines.forEach((text, i) => {
        if (/^\s*(\/\/|\/\*|\*)/.test(text)) return; // comments are not shown to anyone
        if (!CLAIMS.some((c) => c.test(text))) return;
        const near = lines.slice(Math.max(0, i - GATE_WINDOW), i + GATE_WINDOW + 1).some((l) => GATE.test(l));
        const annotated = text.includes(ANNOTATION);
        out.push({
          file: relative(ROOT, f),
          line: i + 1,
          text: text.trim().slice(0, 120),
          gated: near || (annotated && fileHasGate),
          annotated,
          annotatedButFileHasNoGate: annotated && !fileHasGate,
        });
      });
    }
  }
  return out;
}

describe("ungated care-team claims (W-53)", () => {
  const found = scan();
  const ungated = found.filter((f) => !f.gated);
  const countByFile = new Map<string, number>();
  for (const f of ungated) countByFile.set(f.file, (countByFile.get(f.file) ?? 0) + 1);

  it("every ungated claim is baselined with a reason and an exact count", () => {
    const bad: string[] = [];
    for (const [file, n] of countByFile) {
      const base = BASELINE[file];
      if (!base) bad.push(`${file}: ${n} ungated claim(s), not baselined (${ungated.find((u) => u.file === file)?.text})`);
      else if (n !== base[0]) bad.push(`${file}: ${n} claims, baseline says ${base[0]}`);
    }
    expect(bad).toEqual([]);
  });

  it("the baseline has no stale entries", () => {
    expect(Object.keys(BASELINE).filter((f) => !countByFile.has(f))).toEqual([]);
  });

  it("an annotated site really references the gate in its file", () => {
    expect(found.filter((f) => f.annotatedButFileHasNoGate).map((f) => `${f.file}:${f.line}`)).toEqual([]);
  });

  it("the two lifestyle logging sites and the three web cards call the gate", () => {
    for (const f of [
      "apps/web/src/app/(dashboard)/patient/lifestyle/actions.ts",
      "apps/web/src/app/api/mobile/lifestyle/log/route.ts",
      "apps/web/src/app/(dashboard)/patient/breast-symptom-card.tsx",
      "apps/web/src/app/(dashboard)/patient/hospital-admissions-card.tsx",
      "apps/web/src/app/(dashboard)/patient/sexual-health/emergency-contraception-card.tsx",
    ]) {
      expect(readFileSync(join(ROOT, f), "utf8")).toMatch(/patientHasDoctorReview|useDoctorReview/);
    }
  });

  it("the detector discriminates: it finds the known gated Member claim and would flag an ungated one", () => {
    expect(found.some((f) => f.file.endsWith("hospital-admissions-card.tsx") && f.gated)).toBe(true);
    expect(CLAIMS.some((c) => c.test("Your care team has been notified."))).toBe(true);
    expect(CLAIMS.some((c) => c.test("No doctor has been alerted about this reading."))).toBe(false);
  });
});

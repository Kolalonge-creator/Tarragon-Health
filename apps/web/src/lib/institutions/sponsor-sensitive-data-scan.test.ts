import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * S-3 (CMO decision, 2026-10-07): mental health, reproductive and pregnancy
 * data are never shown to any sponsor (employer, HMO, payer, NGO, provider
 * organisation) at any cohort size. Spec 24.3 and founder rule I9.
 *
 * A live loader once read mental_health_screens for the employer dashboard
 * (PHQ-9 and GAD-7 severity bands). This scan keeps that class of mistake out:
 * any sponsor-facing file that names a sensitive table or instrument fails the
 * build. If a legitimate reference is ever needed, it belongs outside these
 * directories, behind the clinician or patient surfaces.
 */

const REPO_ROOT = path.resolve(__dirname, "../../../../..");

const SPONSOR_DIRS = [
  "apps/web/src/lib/corporate",
  "apps/web/src/lib/institutions",
  "apps/web/src/lib/payer",
  "apps/web/src/app/(dashboard)/dashboard",
  "apps/web/src/app/(dashboard)/payer",
  "apps/web/src/app/(dashboard)/provider-org",
  "apps/console/src",
  "packages/staff-core/src/sponsors",
  "packages/staff-core/src/ngo",
];

const FORBIDDEN = [
  /mental_health_screens/i,
  /\bphq[-_ ]?9\b/i,
  /\bgad[-_ ]?7\b/i,
  /menstrual/i,
  /pregnan/i,
  /reproductive/i,
  /fertility/i,
  /contracepti/i,
];

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
}

describe("sponsor surfaces never touch mental health, reproductive or pregnancy data", () => {
  const files: string[] = [];
  for (const dir of SPONSOR_DIRS) walk(path.join(REPO_ROOT, dir), files);

  it("scans a non-trivial set of sponsor-facing files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("finds no forbidden table, instrument or topic in any of them", () => {
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) {
          hits.push(`${path.relative(REPO_ROOT, file)} matches ${pattern}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

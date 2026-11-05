import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Founder decision DIR-5 (2026-11-05): patient-facing and public copy never says Tarragon takes "no commission" or "no cut"
 * on a test. A laboratory may choose to pay Tarragon a commission (DIR-1 Preferred Partner), which is the laboratory's choice
 * and not an obligation, and Tarragon collects nothing from the patient for the test. The true statements are "you pay the
 * laboratory directly, at its price" and "Tarragon does not charge you for this test".
 */
const ROOT = join(__dirname, "..", "..", "..", "..", "..");
const DIRS = ["apps/web/src", "apps/mobile/src", "packages/i18n/src"].map((d) => join(ROOT, d));
const SKIP = /(\/admin\/|\/finance\/|\/lab-partner\/|\/pharmacist\/|\/analytics\/|node_modules|\.test\.)/;
// Devices are a different matter: Tarragon sells no device and earns nothing on one (2026-08-02 decision).
const ALLOWED = ["earns no commission on any device"];
const BANNED = /(take[s]? no commission|no commission[,."]|take[s]? no cut|no cut of|fee or commission|no part of the fee|take nothing on it|take nothing from it)/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : walk(p);
    return /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe("no 'no commission' claims in patient-facing or public copy (DIR-5)", () => {
  it("no source file states that Tarragon takes no commission or cut on a test", () => {
    const offenders: string[] = [];
    for (const file of DIRS.flatMap(walk)) {
      const rel = relative(ROOT, file);
      if (SKIP.test(`/${rel}`)) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, "");
        if (BANNED.test(code) && !ALLOWED.some((a) => code.includes(a))) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

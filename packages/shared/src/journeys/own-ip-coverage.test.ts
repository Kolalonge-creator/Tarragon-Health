import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Every browser spec that signs in through the /login form must send its own client address (apps/web/e2e-browser/helpers/own-ip.ts).
// Without it the spec shares the one 20-per-5-minutes sign-in bucket with every other spec, and a new spec tips the suite over that
// limit: staff-patient-chat did exactly that on 2026-10-30 (PR 1558). This scan fails the day a spec signs in without it.

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const DIR = join(ROOT, "apps", "web", "e2e-browser");

function specs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "helpers" || e.name === "harness" ? [] : specs(p);
    return e.name.endsWith(".spec.ts") ? [p] : [];
  });
}

const SIGNS_IN = /goto\("\/login"\)|\bloginAs\(|\blogin\(/;

describe("browser specs that sign in through the form", () => {
  it("each one gives its browser context its own client address", () => {
    const all = specs(DIR);
    expect(all.length).toBeGreaterThan(5);
    const missing = all.filter((p) => SIGNS_IN.test(readFileSync(p, "utf8")) && !readFileSync(p, "utf8").includes("ownIp()"));
    expect(missing.map((p) => p.slice(DIR.length + 1))).toEqual([]);
  });

  it("the scan sees the specs that sign in today", () => {
    const signing = specs(DIR).filter((p) => SIGNS_IN.test(readFileSync(p, "utf8"))).length;
    expect(signing).toBeGreaterThanOrEqual(8);
  });
});

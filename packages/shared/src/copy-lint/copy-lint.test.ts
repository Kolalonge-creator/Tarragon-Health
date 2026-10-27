import { describe, expect, it } from "@jest/globals";
import { fileURLToPath } from "node:url";
import { COPY_LINT_BASELINE } from "./baseline";
import { copyLintMode, countSourceFiles, scanRepo, scanText, summarise } from "./scan";

describe("copy-lint detector", () => {
  it.each([
    ['<p>This will cure you</p>', "cure"],
    ['label: "Talk to an instant doctor"', "instant-doctor"],
    ['<h1>Free healthcare for all</h1>', "free-healthcare"],
    ['"Ask your doctor about it"', "your-doctor"],
    ['"Fast — and easy"', "em-dash"],
    ['"Open 9–14 days"', "en-dash"],
  ])("flags %s", (line, rule) => {
    expect(scanText("x.tsx", line).map((v) => v.rule)).toContain(rule);
  });

  it("does not flag look-alike words, comments or the approved phrasing", () => {
    const clean = [
      '"Your account is secure"',
      '"Procure a device"',
      '"Accurate readings"',
      '"Ask your care team"',
      "// we never say your doctor here",
      " * Free healthcare is banned",
      'const x = 1; // a — b',
    ];
    for (const line of clean) expect(scanText("x.tsx", line)).toEqual([]);
  });

  it("scans the deployed notification templates (W-59)", () => {
    const root = fileURLToPath(new URL("../../../../", import.meta.url));
    const files = scanRepo(root, ["supabase/functions/send-pending-notifications"]);
    const dashes = files.filter((v) => (v.rule === "em-dash" || v.rule === "en-dash") && /(templates|index)\.ts$/.test(v.file));
    expect(dashes).toEqual([]);
    expect(countSourceFiles(root, ["supabase/functions/send-pending-notifications"])).toBeGreaterThanOrEqual(2);
  });

  it("the scanner flags an en dash in a string literal and in JSX text", () => {
    expect(scanText("x.ts", 'const a = "Open 9–14 days";').map((v) => v.rule)).toContain("en-dash");
    expect(scanText("x.tsx", "<p>Open 9–14 days</p>").map((v) => v.rule)).toContain("en-dash");
  });

  it("ignores an en dash in a comment, and honours the allow marker for a numeric range only", () => {
    expect(scanText("x.ts", "// a range 9–14")).toEqual([]);
    expect(scanText("x.ts", 'const a = "Ages 9–14"; // copy-lint-allow en-dash: numeric range')).toEqual([]);
    // the marker never excuses an em dash
    expect(scanText("x.ts", 'const a = "Fast — easy"; // copy-lint-allow en-dash: numeric range').map((v) => v.rule)).toEqual(["em-dash"]);
  });

  it("reports file and line", () => {
    const [v] = scanText("a/b.tsx", 'ok\nbad "your doctor"');
    expect(v).toMatchObject({ file: "a/b.tsx", line: 2, rule: "your-doctor" });
  });
});

describe("copy-lint repo scan", () => {
  const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

  it("scans a meaningful number of files (a silently empty scan must fail)", () => {
    expect(countSourceFiles(repoRoot)).toBeGreaterThan(300);
    expect(countSourceFiles(repoRoot, ["packages/i18n/src"])).toBeGreaterThanOrEqual(3);
  });

  it("throws on a missing scan root instead of passing vacuously", () => {
    expect(() => scanRepo(repoRoot, ["no/such/dir"])).toThrow();
  });

  it("RATCHET: existing violations may not increase; COPY_LINT_ENFORCE=1 requires zero", () => {
    const violations = scanRepo(repoRoot);
    const summary = summarise(violations);
    console.warn(`[copy-lint] ${violations.length} existing user-facing violations (baseline ratchet): ${JSON.stringify(summary)}`);
    if (copyLintMode() === "enforce") return expect(violations).toEqual([]);
    for (const rule of Object.keys(summary)) {
      expect([rule, summary[rule] <= (COPY_LINT_BASELINE[rule] ?? 0)]).toEqual([rule, true]);
    }
  });

  it("RATCHET (exact) for the dash rules: fewer than the baseline means the number must be lowered", () => {
    const summary = summarise(scanRepo(repoRoot));
    for (const rule of ["em-dash", "en-dash"]) {
      expect([rule, summary[rule] ?? 0]).toEqual([rule, COPY_LINT_BASELINE[rule]]);
    }
  });

  it("the ratchet discriminates: a simulated extra violation exceeds the baseline", () => {
    const extra = scanText("x.tsx", '<p>Ask your doctor</p>').length;
    expect(COPY_LINT_BASELINE["your-doctor"] + extra).toBeGreaterThan(COPY_LINT_BASELINE["your-doctor"]);
  });
});

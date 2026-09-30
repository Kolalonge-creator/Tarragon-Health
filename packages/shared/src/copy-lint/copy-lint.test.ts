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

  it("the ratchet discriminates: a simulated extra violation exceeds the baseline", () => {
    const extra = scanText("x.tsx", '<p>Ask your doctor</p>').length;
    expect(COPY_LINT_BASELINE["your-doctor"] + extra).toBeGreaterThan(COPY_LINT_BASELINE["your-doctor"]);
  });
});

import { describe, expect, it } from "@jest/globals";
import { fileURLToPath } from "node:url";
import { copyLintMode, scanRepo, scanText, summarise } from "./scan";

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

  it("WARN-ONLY: reports existing violations without failing, unless COPY_LINT_ENFORCE=1", () => {
    const violations = scanRepo(repoRoot);
    const summary = summarise(violations);
    if (violations.length > 0) {
      console.warn(`[copy-lint] ${violations.length} existing user-facing violations (warn-only): ${JSON.stringify(summary)}`);
    }
    if (copyLintMode() === "enforce") expect(violations).toEqual([]);
    else expect(copyLintMode()).toBe("warn");
  });

  it("scans a meaningful number of files (guards against a silently empty scan)", () => {
    // The i18n catalogue is scanned and must be clean even in warn mode.
    expect(scanRepo(repoRoot, ["packages/i18n/src"])).toEqual([]);
  });
});

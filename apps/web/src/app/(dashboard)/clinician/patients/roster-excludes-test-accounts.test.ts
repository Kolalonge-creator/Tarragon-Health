import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";

/**
 * INV-13 regression guard for the org patient directory (/clinician/patients).
 *
 * Found 2026-11-03: the roster query read every `role = 'patient'` profile with
 * no `is_test` filter, so "First Patient" and the other QA accounts sat in a
 * real doctor's patient list next to real people, with nothing to tell them
 * apart. The page is an async server component with the query inline (an app
 * router page may only export a fixed set of names), so this reads the source
 * the same way signup-copy.test.ts does, comments stripped first.
 */
function sourceOf(...segments: string[]): string {
  return readFileSync(join(__dirname, ...segments), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

describe("clinician patient roster excludes test accounts (INV-13)", () => {
  const page = sourceOf("page.tsx");

  it("filters the profiles roster read on is_test = false", () => {
    // The roster read is the only `.from("profiles")` in the page; its filter
    // chain must carry the test-account exclusion next to the role filter.
    const rosterReads = page.match(/\.from\("profiles"\)[\s\S]*?\.limit\(/g) ?? [];
    expect(rosterReads.length).toBeGreaterThan(0);
    for (const read of rosterReads) {
      expect(read).toContain('.eq("role", "patient")');
      expect(read).toContain('.eq("is_test", false)');
    }
  });
});

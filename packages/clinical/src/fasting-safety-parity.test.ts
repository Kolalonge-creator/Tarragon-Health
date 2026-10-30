import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The pure gate (fasting-safety.ts) and its enforcing database twin (private.fasting_gate_for) must agree. Both are tested against the same
 * numbered cases; this pins the two case lists together so a case added on one side and forgotten on the other fails here, in the TypeScript run.
 * Ids FS32 to FS34 are TypeScript-only (they exercise inputs the database cannot be given: a withheld answer, a null config, an unreadable clock).
 */
const HERE = fileURLToPath(new URL(".", import.meta.url));
const ids = (text: string): string[] => [...new Set([...text.matchAll(/\bFS\d{2}\b/g)].map((m) => m[0]))].sort();
const TS_ONLY = ["FS32", "FS33", "FS34"];

describe("fasting gate parity with the SQL proof", () => {
  const ts = readFileSync(join(HERE, "fasting-safety.test.ts"), "utf8");
  const sql = readFileSync(join(HERE, "..", "..", "db", "tests", "s50b_fasting_safety.sql"), "utf8");

  it("the same case ids appear in both (bar the TypeScript-only ones)", () => {
    const tsIds = ids(ts).filter((i) => !TS_ONLY.includes(i));
    expect(tsIds.length).toBeGreaterThanOrEqual(30);
    expect(ids(sql)).toEqual(tsIds);
  });

  it("the proof is registered in the CI manifest", () => {
    const manifest = readFileSync(join(HERE, "..", "..", "db", "tests", "ci.manifest"), "utf8");
    expect(manifest.split("\n")).toContain("s50b_fasting_safety.sql");
  });
});

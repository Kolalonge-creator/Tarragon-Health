import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The pure gate (activity-gate.ts) and its enforcing database twin (private.activity_gate_for) must agree. Both are tested against the same
 * numbered cases; this pins the two case lists together so a case added on one side and forgotten on the other fails here, in the TypeScript run.
 */
const HERE = fileURLToPath(new URL(".", import.meta.url));
const ids = (text: string): string[] => [...new Set([...text.matchAll(/"(C\d{2})[":]|'(C\d{2}) |\b(C\d{2}):|"(C\d{2})"/g)].map((m) => (m[1] ?? m[2] ?? m[3] ?? m[4]) as string))].sort();

describe("activity gate parity with the SQL proof", () => {
  const ts = readFileSync(join(HERE, "activity-gate.test.ts"), "utf8");
  const sql = readFileSync(join(HERE, "..", "..", "db", "tests", "s48a_activity_safety_gate.sql"), "utf8");

  it("the same case ids appear in both", () => {
    const tsIds = ids(ts);
    const sqlIds = ids(sql);
    expect(tsIds.length).toBeGreaterThanOrEqual(25);
    expect(sqlIds).toEqual(tsIds);
  });

  it("the proof is registered in the CI manifest", () => {
    const manifest = readFileSync(join(HERE, "..", "..", "db", "tests", "ci.manifest"), "utf8");
    expect(manifest.split("\n")).toContain("s48a_activity_safety_gate.sql");
  });
});

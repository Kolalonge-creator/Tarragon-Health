/**
 * Front Desk M1: the seeded follow-up email copy obeys INV-07 (patient email never names a condition, reading, result or medicine), uses only
 * the two allowed placeholders, and carries no dash punctuation the brand voice bans. The copy lives in the seed migration (it is data a person
 * approves), so this test reads the migration and lints every subject and body in it. A future edit that slips a forbidden word into a seed fails here.
 */
import "./support/deno.ts";
import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describeViolations, lintText } from "./index.ts";

// Found by suffix, not by timestamp: a migration is renamed when its version collides with another session's.
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const MIGRATION = MIGRATIONS_DIR + (readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith("_fd_m1_front_desk_foundations.sql")) ?? "missing_fd_m1_front_desk_foundations.sql");

/** Every single-quoted SQL string (with '' as an escaped quote) in the step seed block, unescaped. */
function stepStrings(): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf("insert into public.fd_sequence_steps");
  const end = sql.indexOf("-- Knowledge drafts");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = sql.slice(start, end);
  const out: string[] = [];
  for (const m of block.matchAll(/E?'((?:[^']|'')*)'/g)) {
    const raw = m[1] ?? "";
    out.push(raw.replace(/''/g, "'").replace(/\\n/g, "\n"));
  }
  // Drop the SQL identifiers/keys that are quoted (sequence keys, step keys, ordering words); copy is always longer than 24 characters.
  return out.filter((s) => s.length > 24 || /\s/.test(s));
}

describe("front desk seeded follow-up copy", () => {
  const strings = stepStrings();

  it("finds the whole seed (15 steps, a subject and a body each)", () => {
    expect(strings.length).toBeGreaterThanOrEqual(30);
  });

  it("names no condition, reading, result or medicine", () => {
    const bad = strings.flatMap((s) => describeViolations(lintText(s)).map((v) => `${v} in: ${s.slice(0, 60)}`));
    expect(bad).toEqual([]);
  });

  it("uses only the two allowed placeholders", () => {
    const used = new Set(strings.flatMap((s) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1])));
    expect([...used].sort()).toEqual(["first_name", "link"]);
  });

  it("has no em or en dashes", () => {
    expect(strings.filter((s) => /[–—]/.test(s))).toEqual([]);
  });

  it("never types a price or a naira amount", () => {
    // Sentences only: the block also quotes the organisation id in a join, which is not copy.
    expect(strings.filter((s) => /\s/.test(s) && /₦|naira|\bNGN\b|\d{3,}/i.test(s))).toEqual([]);
  });
});

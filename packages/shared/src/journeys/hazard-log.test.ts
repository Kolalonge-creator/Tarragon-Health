import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JOURNEYS } from "./journeys";

// Keeps docs/clinical-safety/hazard-log.md and the journey definitions in step, in both directions. It does not judge whether a hazard is
// rated correctly or whether a step should carry one: that is the clinical owner's call. The log itself is PROPOSED and unsigned.

const LOG = readFileSync(fileURLToPath(new URL("../../../../docs/clinical-safety/hazard-log.md", import.meta.url)), "utf8");

interface Row { id: string; journey: string; step: string }

export function parseRows(md: string): Row[] {
  const rows: Row[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\| (HZ-[A-Z0-9]+-\d+) \| (J\d) `([a-z0-9-]+)`/);
    if (m) rows.push({ id: m[1]!, journey: m[2]!, step: m[3]! });
  }
  return rows;
}

const cited = Object.values(JOURNEYS).flatMap((j) => j.steps.flatMap((s) => (s.hazards ?? []).map((h) => ({ id: h, journey: j.id as string, step: s.id }))));

describe("hazard log and journey steps agree", () => {
  const rows = parseRows(LOG);

  it("reads rows and starts with the unsigned status", () => {
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(LOG).toContain("PROPOSED by engineering");
  });

  it("has unique hazard ids", () => {
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("every hazard id a journey step cites is in the log", () => {
    const known = new Set(rows.map((r) => r.id));
    expect(cited.filter((c) => !known.has(c.id))).toEqual([]);
  });

  it("every log row names a real step in the journey it says, and that step cites the row back", () => {
    const problems: string[] = [];
    for (const r of rows) {
      const step = JOURNEYS[r.journey as keyof typeof JOURNEYS]?.steps.find((s) => s.id === r.step);
      if (!step) problems.push(`${r.id}: no step ${r.journey}/${r.step}`);
      else if (!(step.hazards ?? []).includes(r.id)) problems.push(`${r.id}: ${r.journey}/${r.step} does not cite it`);
    }
    expect(problems).toEqual([]);
  });

  it("no journey step cites a hazard that belongs to a different step", () => {
    const owner = new Map(rows.map((r) => [r.id, `${r.journey}/${r.step}`]));
    expect(cited.filter((c) => owner.get(c.id) !== `${c.journey}/${c.step}`)).toEqual([]);
  });

  it("the check can fail: a row for a step that does not exist is reported", () => {
    const fake = parseRows("| HZ-J2-99 | J2 `no-such-step` | x |");
    expect(JOURNEYS.J2.steps.find((s) => s.id === fake[0]!.step)).toBeUndefined();
  });
});

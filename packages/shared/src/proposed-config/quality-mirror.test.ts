import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

describe("quality.audit mirrors the migration seed", () => {
  it("is identical to the quality_config seed", () => {
    // The newest migration that seeds a quality_config row is the live one (each version retires the last).
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .filter((f) => readFileSync(join(MIGRATIONS, f), "utf8").includes("quality-audit-begin"));
    const file = files[files.length - 1];
    if (!file) throw new Error("S20 migration not found");
    const match = /quality-audit-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    if (!match?.[1]) throw new Error("quality audit seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("quality.audit").value);
  });

  it("the spec's proposals hold (7.8): 10 percent, every red event and titration", () => {
    const v = getProposedConfig("quality.audit").value as { sampling: { random_rate_percent: number; always_reasons: string[] } };
    expect(v.sampling.random_rate_percent).toBe(10);
    expect(v.sampling.always_reasons).toEqual(["red_event", "titration"]);
  });

  it("Q16: a new clinician's first 20 red or prescribing cases are all audited (a design choice, not a guideline figure)", () => {
    const v = getProposedConfig("quality.audit").value as { sampling: { new_clinician_full_review_cases: number } };
    expect(v.sampling.new_clinician_full_review_cases).toBe(20);
  });
});

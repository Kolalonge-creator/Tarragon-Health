import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

describe("triage.coverage mirrors the migration seed (P6)", () => {
  it("is identical to the triage_coverage_config v1 seed, and is born off", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_p6_triage_coverage.sql"));
    if (!file) throw new Error("P6 migration not found");
    const match = /triage-coverage-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    if (!match?.[1]) throw new Error("triage coverage seed not found in the migration");
    const seed = JSON.parse(match[1]) as Record<string, unknown>;
    expect(seed).toEqual(getProposedConfig("triage.coverage").value);
    expect(seed.enabled).toBe(false);
  });
});

import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seed(): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s27h_lab_lifecycle_and_quality.sql"));
  if (!file) throw new Error("S27h migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = /lab-lifecycle-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("lab lifecycle seed not found in the migration");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("lab.lifecycle mirrors the migration seed", () => {
  it("is identical, so the registry and lab_lifecycle_config cannot drift", () => {
    expect(seed()).toEqual(getProposedConfig("lab.lifecycle").value);
  });

  it("stays proposed and owned by the CMO until signed", () => {
    const e = getProposedConfig("lab.lifecycle");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("CMO");
  });

  it("names no release or auto-release setting: nothing here can release a result", () => {
    expect(JSON.stringify(getProposedConfig("lab.lifecycle").value)).not.toMatch(/release/i);
  });
});

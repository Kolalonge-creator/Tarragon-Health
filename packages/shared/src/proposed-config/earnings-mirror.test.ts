import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

describe("earnings.rules mirrors the migration seed", () => {
  it("is identical to the earnings_config seed", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s30_fee_schedules_and_earnings_ledger.sql"));
    if (!file) throw new Error("S30 migration not found");
    const match = /earnings-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    if (!match?.[1]) throw new Error("earnings rules seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("earnings.rules").value);
  });

  it("holds no money: fee amounts are set by the founder, never in code", () => {
    expect(JSON.stringify(getProposedConfig("earnings.rules").value)).not.toMatch(/kobo/);
  });

  it("the proof's embedded cases are the shared fee cases (no drift between Jest and SQL)", () => {
    const sql = readFileSync(join(ROOT, "packages", "db", "tests", "s30_fee_schedules_and_earnings_ledger.sql"), "utf8");
    const match = /fee-cases-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("embedded cases not found in the proof");
    const shared: unknown = JSON.parse(readFileSync(join(ROOT, "packages", "queue", "fixtures", "fee-cases.json"), "utf8"));
    expect(JSON.parse(match[1])).toEqual(shared);
  });
});

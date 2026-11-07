import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

/**
 * Reads every `insert into public.ops_alert_rules` seed between its markers, in migration order: (code, title, severity, source,
 * enabled, params json, ...). SR5 seeded the first 14; a later migration that adds a rule carries the same markers.
 */
function seeded(): Record<string, { severity: string; params: Record<string, unknown> }> {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => readFileSync(join(MIGRATIONS, f), "utf8").includes("ops-alert-rules-begin"));
  if (!files.some((f) => f.endsWith("_sr5_alert_rules_and_operations_wall.sql"))) throw new Error("SR5 migration not found");
  const out: Record<string, { severity: string; params: Record<string, unknown> }> = {};
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const block = /ops-alert-rules-begin([\s\S]*?)ops-alert-rules-end/.exec(sql)?.[1];
    if (!block) throw new Error(`rule seed markers not closed in ${file}`);
    for (const m of block.matchAll(/\('([a-z0-9_]+)',\s*'[^']*',\s*'(sev\d)',\s*'(?:database|external)',\s*(?:true|false),\s*'(\{[^']*\})'::jsonb/g)) {
      out[m[1] as string] = { severity: m[2] as string, params: JSON.parse(m[3] as string) as Record<string, unknown> };
    }
  }
  return out;
}

describe("ops.alert_rules mirrors the migration seed", () => {
  it("is identical, so the registry and ops_alert_rules cannot drift", () => {
    expect(seeded()).toEqual(getProposedConfig("ops.alert_rules").value);
  });
  it("covers the 14 rules of the plan plus ai_call_failures and support_sla_breach", () => {
    expect(Object.keys(seeded())).toHaveLength(16);
    expect(seeded()).toHaveProperty("ai_call_failures");
    expect(seeded()).toHaveProperty("support_sla_breach");
  });
});

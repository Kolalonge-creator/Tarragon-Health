import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migrationSql(): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_ops_desk_expired_page_resilience.sql"));
  if (!file) throw new Error("ops desk migration not found");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

function seeded(marker: string): Record<string, unknown> {
  const match = new RegExp(marker + "[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$").exec(migrationSql());
  if (!match?.[1]) throw new Error(`seed ${marker} not found in the migration`);
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("ops_desk.rules mirrors the migration seed", () => {
  it("v1 is identical to the active ops_desk_config row and gates nothing", () => {
    const v1 = getProposedConfig("ops_desk.rules").value as Record<string, unknown>;
    expect(seeded("ops-desk-rules-begin")).toEqual(v1);
    expect(v1.checklist_gates_readiness).toBe(0);
  });

  it("v2 mirrors the inactive row and differs from v1 only in switching the checklist gate on", () => {
    const v1 = getProposedConfig("ops_desk.rules").value as Record<string, unknown>;
    const v2 = getProposedConfig("ops_desk.rules_v2").value as Record<string, unknown>;
    expect(seeded("ops-desk-rules-v2-begin")).toEqual(v2);
    expect({ ...v2, checklist_gates_readiness: 0 }).toEqual(v1);
    expect(v2.checklist_gates_readiness).toBe(1);
  });

  it("keeps the deputy time at five minutes (PROPOSED) and the checklist age at 90 days", () => {
    const v = getProposedConfig("ops_desk.rules").value as Record<string, number>;
    expect(v.deputy_after_seconds).toBe(300);
    expect(v.checklist_max_age_days).toBe(90);
  });
});

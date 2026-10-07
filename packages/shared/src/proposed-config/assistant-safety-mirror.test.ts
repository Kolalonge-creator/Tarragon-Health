import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";
import { isAiExcludedAnalyte } from "../assistant-safety";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

describe("assistant.excluded_analytes mirrors the INV-04 migration seed", () => {
  it("is identical to the ai_excluded_analyte_tokens seed", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s51_inv04_ai_never_reads_sensitive_results.sql"));
    if (!file) throw new Error("INV-04 migration not found");
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const match = /ai-excluded-analytes-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("seed not found");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("assistant.excluded_analytes").value);
  });
});

describe("isAiExcludedAnalyte (INV-04)", () => {
  it("excludes every non-negative screening result, whatever the spelling", () => {
    expect(isAiExcludedAnalyte("hiv_screen", "positive")).toBe(true);
    expect(isAiExcludedAnalyte("HBsAg", "positive")).toBe(true);
    expect(isAiExcludedAnalyte("anti-HCV", "reactive")).toBe(true);
    expect(isAiExcludedAnalyte("hcv_ab", null)).toBe(true);
    expect(isAiExcludedAnalyte("HIV 1/2", "")).toBe(true);
    expect(isAiExcludedAnalyte("cd4_count", null)).toBe(true);
    expect(isAiExcludedAnalyte("HBV DNA", null)).toBe(true);
    expect(isAiExcludedAnalyte("hbeag", "positive")).toBe(true);
    expect(isAiExcludedAnalyte("viral_load", null)).toBe(true);
  });
  it("lets an explicit negative and ordinary analytes through", () => {
    expect(isAiExcludedAnalyte("hiv_screen", "negative")).toBe(false);
    expect(isAiExcludedAnalyte("hbsag", " Non-Reactive ")).toBe(false);
    expect(isAiExcludedAnalyte("hba1c", null)).toBe(false);
    expect(isAiExcludedAnalyte("creatinine", null)).toBe(false);
  });
});

describe("assistant.go_live mirrors the assistant_config seed", () => {
  it("is identical to the go_live row", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s51_assistant_guard_knowledge_events.sql"));
    if (!file) throw new Error("S51 migration not found");
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const match = /assistant-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("seed not found");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("assistant.go_live").value);
  });
});

describe("assistant.silence, .review and .memory mirror the S52 assistant_config seed", () => {
  it("are identical to the seeded values", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s52_assistant_safety_memory_review.sql"));
    if (!file) throw new Error("S52 migration not found");
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const match = /assistant-config-s52-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("seed not found");
    const seeded = JSON.parse(match[1]) as Record<string, unknown>;
    for (const key of ["silence", "review", "memory", "paging"]) {
      expect(seeded[key]).toEqual(getProposedConfig(`assistant.${key}`).value);
    }
  });
});

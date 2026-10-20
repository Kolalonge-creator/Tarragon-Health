import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

describe("triage.glucose_monitor mirrors the migration seed (OQ-320)", () => {
  it("is identical to the triage_glucose_monitor_config v1 seed", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_fu_glucose_monitor_and_wearable_grading.sql"));
    if (!file) throw new Error("glucose monitor migration not found");
    const match = /glucose-monitor-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    if (!match?.[1]) throw new Error("glucose monitor seed not found in the migration");
    const seed = JSON.parse(match[1]) as Record<string, unknown>;
    expect(seed).toEqual(getProposedConfig("triage.glucose_monitor").value);
  });

  it("carries the founder's proposed numbers: 30 minutes fresh, 60 minutes dedupe, wearable and cgm only", () => {
    expect(getProposedConfig("triage.glucose_monitor").value).toEqual({ enabled: true, freshMinutes: 30, dedupeMinutes: 60, sources: ["wearable", "cgm"] });
    expect(getProposedConfig("triage.glucose_monitor").status).toBe("proposed");
  });
});

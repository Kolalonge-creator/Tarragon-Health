import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seed(): { safety: unknown; calendar: unknown } {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s50b_fasting_safety_and_glucose_response.sql"));
  if (!file) throw new Error("S50b migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const match = /fasting-safety-config-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
  if (!match?.[1]) throw new Error("fasting_safety_config seed not found in the migration");
  return JSON.parse(match[1]);
}

describe("fasting config mirrors the migration seed", () => {
  it("the safety rules match the registry entry", () => {
    expect(seed().safety).toEqual(getProposedConfig("fasting.safety_rules").value);
  });

  it("the calendar matches the registry entry", () => {
    expect(seed().calendar).toEqual(getProposedConfig("fasting.calendar").value);
  });

  it("every S50b entry is PROPOSED and owned by the CMO (an agent never confirms them)", () => {
    for (const key of ["fasting.safety_rules", "fasting.calendar", "glucose_response.rules"]) {
      const e = getProposedConfig(key);
      expect(e.status).toBe("proposed");
      expect(e.owner).toBe("CMO");
    }
  });

  it("a red event is never softened and the medicine classes the spec names are present", () => {
    const v = getProposedConfig("fasting.safety_rules").value as { outcomes: Record<string, string>; medicine_classes: Record<string, unknown> };
    expect(v.outcomes.recent_red_event).toBe("not_advised");
    expect(Object.keys(v.medicine_classes).sort()).toEqual(["insulin", "other_diabetes", "sulfonylurea"]);
  });

  it("the calendar lists only expected windows, each ending on or after it starts", () => {
    const v = getProposedConfig("fasting.calendar").value as Record<string, { start: string; end: string }[]>;
    for (const fast of ["ramadan", "lent"]) {
      expect(v[fast]?.length).toBeGreaterThan(0);
      for (const w of v[fast] ?? []) expect(w.end >= w.start).toBe(true);
    }
  });

  it("the glucose-response sample floor is at least 3 (a pattern from fewer pairs is not shown)", () => {
    const v = getProposedConfig("glucose_response.rules").value as { min_pairs_to_show: number };
    expect(v.min_pairs_to_show).toBeGreaterThanOrEqual(3);
  });
});

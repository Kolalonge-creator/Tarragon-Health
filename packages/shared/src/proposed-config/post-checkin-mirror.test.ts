import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

type Option = { code: string; label: string; route: string; alert_type?: string };
type Rules = {
  offsets: { code: string; after_minutes: number }[];
  encounter_types: string[];
  nudge_after_minutes: number;
  max_nudges: number;
  expire_after_minutes: number;
  questions: { id: string; text: string; options: Option[] }[];
};

describe("consultations.post_checkin mirrors the migration seed", () => {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_pcc_post_consult_checkins.sql"));
  if (!file) throw new Error("PCC migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const cfg = getProposedConfig<Rules>("consultations.post_checkin");

  it("is identical to the post_consult_checkin_config seed", () => {
    const match = /pcc-config-v1-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("PCC seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(cfg.value);
  });

  it("is seeded unsigned and inactive (nothing is signed by an agent)", () => {
    expect(sql).toMatch(/values \(1, false, '2026-10-16'/);
    expect(cfg.status).toBe("proposed");
  });

  it("checks in at 48 hours and 7 days, nudges once, video audio and phone only", () => {
    expect(cfg.value.offsets).toEqual([
      { code: "h48", after_minutes: 2880 },
      { code: "d7", after_minutes: 10080 },
    ]);
    expect(cfg.value.max_nudges).toBe(1);
    expect(cfg.value.encounter_types).toEqual(["video", "audio", "phone"]);
  });

  it("asks four short questions and every option has a known route", () => {
    expect(cfg.value.questions).toHaveLength(4);
    for (const q of cfg.value.questions) {
      for (const o of q.options) expect(["ok", "concern_alert", "clinician_task", "clarify_task"]).toContain(o.route);
    }
  });

  it("uses no em dash and never says your doctor", () => {
    const text = JSON.stringify(cfg.value);
    expect(text).not.toContain("—");
    expect(text.toLowerCase()).not.toContain("your doctor");
  });
});

import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function seed(marker: string, suffix = "_s55_learning_centre_foundation.sql"): unknown {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`migration ${suffix} not found`);
  const m = new RegExp(`learning-${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!m?.[1]) throw new Error(`seed ${marker} not found in the migration`);
  return JSON.parse(m[1]);
}

describe("learning.* configuration mirrors the learning_config seeds", () => {
  it("micro_lesson", () => expect(seed("micro-lesson")).toEqual(getProposedConfig("learning.micro_lesson").value));
  it("offline_pack", () => expect(seed("offline-pack")).toEqual(getProposedConfig("learning.offline_pack").value));
  it("creator_perk", () => expect(seed("creator-perk", "_s55_weekly_lesson_and_members_only_creator_series.sql")).toEqual(getProposedConfig("learning.creator_perk").value));
  it("expiry_alerts", () => expect(seed("expiry-alerts", "_learning_expiry_backlog.sql")).toEqual(getProposedConfig("learning.expiry_alerts").value));
  it("search_gap_log", () => expect(seed("search-gap")).toEqual(getProposedConfig("learning.search_gap_log").value));
  it("search_synonyms", () =>
    expect(seed("synonyms")).toEqual((getProposedConfig("learning.search_synonyms").value as { groups: unknown }).groups));

  const QG = "_learning_quality_gates.sql";
  const RL = "_learning_record_lessons_and_portion_guide.sql";
  it("reading_grade (quality gate 12a)", () => expect(seed("reading-grade", QG)).toEqual(getProposedConfig("learning.reading_grade").value));
  it("teachback (quality gate 12c)", () => expect(seed("teachback", QG)).toEqual(getProposedConfig("learning.teachback").value));
  it("record_lessons (item 7)", () => expect(seed("record-lessons", RL)).toEqual(getProposedConfig("learning.record_lessons").value));
  it("portion_guide (item 8)", () => expect(seed("portion-guide", RL)).toEqual(getProposedConfig("learning.portion_guide").value));

  it("the seeded portion guide rows are proposed in the database as well", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(RL));
    const sql = readFileSync(join(MIGRATIONS, file as string), "utf8");
    const block = /learning-portion-guide-begin[\s\S]*?\$json\$::jsonb, '(\w+)'/.exec(sql);
    expect(block?.[1]).toBe("proposed");
  });

  it("every value is proposed and unsigned (no sign-off was created)", () => {
    for (const k of ["micro_lesson", "offline_pack", "creator_perk", "search_gap_log", "search_synonyms", "expiry_alerts", "reading_grade", "teachback", "record_lessons", "portion_guide"]) {
      expect(getProposedConfig(`learning.${k}`).status).toBe("proposed");
    }
  });
});

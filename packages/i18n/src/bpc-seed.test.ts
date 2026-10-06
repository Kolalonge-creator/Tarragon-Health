import { describe, expect, it } from "@jest/globals";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BPC_LESSONS } from "./bpc-course";
import { BRE01_SCRIPT_PACE, renderBre01Script } from "./bre01-script";
import { LONG_FORM_SCRIPTS_FILE, SEED_MIGRATION_FILE, renderBpcSeedSql, renderLongFormScripts } from "./bpc-seed";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const seedPath = resolve(repo, "supabase/migrations", SEED_MIGRATION_FILE);
const scriptsPath = resolve(repo, "audio/source", LONG_FORM_SCRIPTS_FILE);
const releasedPath = resolve(repo, "audio/source/pcm-released.json");

const released: string[] = existsSync(releasedPath) ? (JSON.parse(readFileSync(releasedPath, "utf8")) as string[]) : [];
const bre01 = { en: renderBre01Script(BRE01_SCRIPT_PACE), pcm: renderBre01Script(BRE01_SCRIPT_PACE), pcm_released: false };
const expectedSeed = renderBpcSeedSql(BPC_LESSONS, released);
const expectedScripts = renderLongFormScripts(BPC_LESSONS, released, { "BRE-01": bre01 });

describe("BPC seed (generated from bpc-course.ts)", () => {
  it("is in step with the source: run UPDATE_BPC_SEED=1 pnpm --filter @tarragon/i18n test bpc-seed to regenerate", () => {
    if (process.env.UPDATE_BPC_SEED === "1") {
      writeFileSync(seedPath, expectedSeed);
      writeFileSync(scriptsPath, expectedScripts);
    }
    expect(readFileSync(seedPath, "utf8")).toBe(expectedSeed);
    expect(readFileSync(scriptsPath, "utf8")).toBe(expectedScripts);
  });

  it("inserts every lesson as draft with no review record, and the programme inactive", () => {
    const sql = expectedSeed.split("\n").filter((l) => !l.startsWith("--")).join("\n");
    const inserts = sql.slice(0, sql.indexOf("do $$"));
    expect((inserts.match(/'draft', false, \$bpc\$BPC-/g) ?? []).length).toBe(14);
    expect(inserts).not.toMatch(/reviewed_by_name|reviewed_at|next_review_due|'published'|'approved'/);
    expect(inserts).toMatch(/'hypertension', 'hypertension', false, 30\)/);
  });

  it("writes no Pidgin row while nothing is released, and only the released ones afterwards", () => {
    expect(released).toEqual([]);
    expect(expectedSeed).not.toMatch(/health_education_translations/);
    const withOne = renderBpcSeedSql(BPC_LESSONS, ["BPC-01"]);
    expect(withOne).toMatch(/insert into public\.health_education_translations/);
    expect(withOne).toMatch(/native_reviewed/);
    expect(withOne.match(/\$bpc\$bpc_/g)?.length).toBeGreaterThan(0);
    // A released id with no written Pidgin (a held lesson) adds nothing.
    expect(renderBpcSeedSql(BPC_LESSONS, ["BPC-02"])).not.toMatch(/health_education_translations/);
  });

  it("ends with assertions that fail if a seeded lesson is visible or reviewed", () => {
    expect(expectedSeed).toMatch(/a seeded lesson is visible or carries a review record/);
    expect(expectedSeed).toMatch(/the course programme must start inactive/);
  });
});

describe("long-form audio scripts", () => {
  it("holds Pidgin as the English words until a lesson is released", () => {
    const s = JSON.parse(expectedScripts) as Record<string, { en: string; pcm: string; pcm_released: boolean }>;
    expect(Object.keys(s)).toEqual([...BPC_LESSONS.map((l) => l.code), "BRE-01"].sort());
    for (const [id, v] of Object.entries(s)) expect([id, v.pcm === v.en, v.pcm_released]).toEqual([id, true, false]);
    const rel = JSON.parse(renderLongFormScripts(BPC_LESSONS, ["BPC-01", "BPC-02"])) as typeof s;
    expect(rel["BPC-01"].pcm_released).toBe(true);
    expect(rel["BPC-01"].pcm).not.toBe(rel["BPC-01"].en);
    expect(rel["BPC-02"].pcm_released).toBe(false);
  });

  it("follows the list's script rules: numbers as words, no dash, no banned word", () => {
    for (const v of Object.values(JSON.parse(expectedScripts) as Record<string, { en: string }>)) {
      expect(/\d/.test(v.en)).toBe(false);
      expect(/—|–/.test(v.en)).toBe(false);
      expect(/\bcures?\b|your doctor|instant doctor|free healthcare|e\.g\./i.test(v.en)).toBe(false);
    }
  });

  it("scripts BRE-01 with one counted breath for every breath in the session", () => {
    const text = renderBre01Script(BRE01_SCRIPT_PACE);
    expect((text.match(/Breathe in, two, three, four\. Breathe out, two, three, four, five, six\./g) ?? []).length).toBe(18);
    expect(text).toMatch(/^Three minute calm\./);
    expect(text).toMatch(/stop and breathe normally/);
    expect(text).toMatch(/Keep taking your medicines/);
    expect(text).not.toMatch(/lower|treat/i);
  });
});

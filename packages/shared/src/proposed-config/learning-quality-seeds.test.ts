import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HAND_SHAPES,
  PORTION_HANDS,
  isPortionGuideBody,
  parsePortionGuide,
  portionFor,
  readingGrade,
  type PortionAudience,
  type PortionGuideConfig,
} from "../learning/index";
import { getProposedConfig } from "./index";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const read = (suffix: string) => readFileSync(join(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix)) as string), "utf8");
const RL = read("_learning_record_lessons_and_portion_guide.sql");
const QG = read("_learning_quality_gates.sql");
const MAX_GRADE = (getProposedConfig("learning.reading_grade").value as { max_grade: number }).max_grade;

/** The text between $q$ ... $q$ that follows a row's code in the seed. */
function bodyOf(code: string): string {
  const at = RL.indexOf(`'${code}'`);
  expect(at).toBeGreaterThan(-1);
  const m = /\$q\$([\s\S]*?)\$q\$/.exec(RL.slice(at));
  expect(m).not.toBeNull();
  return (m as RegExpExecArray)[1] as string;
}

describe("seeded portion guides (DRAFT)", () => {
  const cfg = getProposedConfig("learning.portion_guide").value as unknown as PortionGuideConfig;
  const guides: [string, PortionAudience][] = [
    ["portion-guide-diabetes", "diabetes"],
    ["portion-guide-bp", "blood_pressure"],
  ];
  for (const [code, audience] of guides) {
    it(`${code}: parses as a portion guide, every hand can be drawn and every amount is in the config`, () => {
      const body = bodyOf(code);
      expect(isPortionGuideBody(body)).toBe(true);
      const parsed = parsePortionGuide(body);
      expect(parsed.foods.length).toBeGreaterThanOrEqual(8);
      for (const f of parsed.foods) {
        expect(PORTION_HANDS).toContain(f.hand);
        expect(HAND_SHAPES[f.hand].length).toBeGreaterThan(0);
        expect([code, f.ref, portionFor(cfg, f.ref, audience)]).not.toContain(null);
        expect(f.tip.length).toBeGreaterThan(0);
      }
    });
    it(`${code}: no number appears in the text itself (the amounts live only in the configuration)`, () => {
      const body = bodyOf(code);
      expect(body.replace(/\[portion [a-z0-9_]+ [a-z_]+\]/g, "")).not.toMatch(/\d/);
    });
  }
  it("the diabetes guide covers drinks and the blood pressure guide covers seasoning cubes, salt and fried food", () => {
    const d = parsePortionGuide(bodyOf("portion-guide-diabetes")).foods.map((f) => f.ref);
    const b = parsePortionGuide(bodyOf("portion-guide-bp")).foods.map((f) => f.ref);
    for (const r of ["swallow", "rice_jollof", "beans", "soup", "plantain", "yam", "bread", "drinks", "fruit"]) expect(d).toContain(r);
    for (const r of ["seasoning_cube", "table_salt", "fried_food", "swallow", "rice_jollof", "soup"]) expect(b).toContain(r);
  });
  it("every amount in the config is a placeholder row (no confirmed status, no clinician owner signed it)", () => {
    expect(getProposedConfig("learning.portion_guide").status).toBe("proposed");
  });
});

describe("seeded draft copy follows the writing rules", () => {
  const texts: [string, string][] = [
    ...["record-bp-in-target", "record-bp-above-target", "record-glucose-in-target", "record-glucose-above-target", "record-lab-hba1c-normal", "record-lab-hba1c-high", "portion-guide-diabetes", "portion-guide-bp"].map(
      (c): [string, string] => [c, bodyOf(c)],
    ),
    ...[...QG.matchAll(/\('([^']+)', '([^']{25,})'/g)].filter((m) => !/learning_teachback/.test(m[1] as string)).map((m): [string, string] => [`glossary:${m[1]}`, m[2] as string]),
  ];
  it("found the texts", () => expect(texts.length).toBeGreaterThanOrEqual(16));
  for (const [name, text] of texts) {
    it(`${name}: reads at or below the proposed maximum grade, has no dash used as punctuation and never says "your doctor"`, () => {
      expect(readingGrade(text).grade).toBeLessThanOrEqual(MAX_GRADE);
      expect(text).not.toMatch(/[—–]/);
      expect(text).not.toMatch(/your doctor/i);
    });
  }
  it("the record lessons refer to the care team and never promise a diagnosis", () => {
    for (const c of ["record-bp-above-target", "record-glucose-above-target", "record-lab-hba1c-high"]) {
      const t = bodyOf(c);
      expect(t).toMatch(/care team/);
      expect(t).not.toMatch(/diagnos/i);
    }
  });
});

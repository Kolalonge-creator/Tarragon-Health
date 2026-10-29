import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeVaccinationStatuses, type VaccinationCatalogRow } from "./vaccination-status";

/**
 * The adult vaccination drafts (migration 20261029184035) are read from the migration itself so the test cannot drift from what
 * shipped. They are inserted INACTIVE until the CMO verifies them; this proves that once activated the real status engine does the
 * right thing for an adult, and that influenza and COVID-19 (not run in Nigeria) are never in the catalogue as active.
 */
const sql = readFileSync(
  join(__dirname, "../../../../../supabase/migrations/20261029184035_adult_vaccination_catalog_drafts.sql"),
  "utf8",
);

function draftRows(): VaccinationCatalogRow[] {
  const rows: VaccinationCatalogRow[] = [];
  const re = /\('([a-z_0-9]+)',\s*'[^']*',\s*'[^']*',\s*'(\{[^']*\})'::jsonb,\s*false\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql))) rows.push({ id: m[1], code: m[1], name: m[1], recommended_age: JSON.parse(m[2]) });
  return rows;
}

// the childhood row the Td clock falls back to, as it exists in the live catalogue
const childBooster3: VaccinationCatalogRow = {
  id: "child_tetanus_booster_3",
  code: "child_tetanus_booster_3",
  name: "Tetanus booster 9 to 15",
  recommended_age: { max_age_years: 16, age_schedule_weeks: [469] },
};
const today = new Date("2026-10-29T12:00:00Z");

describe("adult vaccination catalogue drafts", () => {
  it("defines exactly the three drafts, all inactive, none of them influenza or COVID-19", () => {
    expect(draftRows().map((r) => r.code).sort()).toEqual(["hepatitis_b_adult", "tetanus_td_booster", "yellow_fever_adult"]);
    // every inserted row is created inactive (the regex only matches rows ending in `false`)
    expect(sql.match(/::jsonb,\s*(true|false)\)/g)).toEqual(["::jsonb, false)", "::jsonb, false)", "::jsonb, false)"]);
    expect(draftRows().some((r) => /influenza|flu|covid/i.test(r.code))).toBe(false);
  });

  it("a 40-year-old with no records is due for all three", () => {
    const out = computeVaccinationStatuses([childBooster3, ...draftRows()], [], { ageYears: 40 }, today);
    const by = Object.fromEntries(out.map((o) => [o.code, o.status]));
    expect(by.tetanus_td_booster).toBe("due");
    expect(by.hepatitis_b_adult).toBe("due");
    expect(by.yellow_fever_adult).toBe("due");
  });

  it("a 17-year-old is not offered the adult hepatitis B series", () => {
    const out = computeVaccinationStatuses(draftRows(), [], { ageYears: 17 }, today);
    expect(out.find((o) => o.code === "hepatitis_b_adult")?.status).toBe("not_yet_due");
  });

  it("the Td clock starts from the last childhood tetanus booster, and is up to date inside ten years", () => {
    const records = [{ vaccination_catalog_id: "child_tetanus_booster_3", dose_number: 1, date_administered: "2022-03-01" }];
    const out = computeVaccinationStatuses([childBooster3, ...draftRows()], records, { ageYears: 30 }, today);
    const td = out.find((o) => o.code === "tetanus_td_booster");
    expect(td?.status).toBe("up_to_date");
  });
});

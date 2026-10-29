import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeScreeningRecommendations, type ScreenTypeRow } from "./screening-recommendations";

/**
 * Mammography is active as an OPTIONAL screen (migration 20261029184629) while breast_imaging is the one recommended breast item.
 * 20260917222259 had deactivated mammography because both were recommended to women 40 to 74: doubled reminders and worklist rows.
 * The row shapes below are the live ones; the app's scheduling caller (patient/actions.ts) drops `isOptional` recommendations, so
 * exactly one NON-optional breast recommendation must remain.
 */
const BREAST_IMAGING: ScreenTypeRow = {
  id: "bi", code: "breast_imaging", sex_applicability: "female", age_from: 18, age_to: null, frequency_months: 24, is_optional: false,
};
const MAMMOGRAPHY: ScreenTypeRow = {
  id: "mm", code: "mammography", sex_applicability: "female", age_from: 40, age_to: 74, frequency_months: 24, is_optional: true,
};
const today = new Date("2026-10-29T12:00:00Z");

describe("mammography is optional, breast_imaging is the recommended item", () => {
  it("a 50-year-old woman gets one non-optional breast recommendation, not two", () => {
    const recs = computeScreeningRecommendations([BREAST_IMAGING, MAMMOGRAPHY], new Map(), { sex: "female", ageYears: 50 }, new Map(), today);
    const scheduled = recs.filter((r) => !r.isOptional).map((r) => r.screenTypeCode);
    expect(scheduled).toEqual(["breast_imaging"]);
    expect(recs.find((r) => r.screenTypeCode === "mammography")?.isOptional).toBe(true);
  });

  it("the migration that makes it optional is the one that ships", () => {
    const sql = readFileSync(
      join(__dirname, "../../../../../supabase/migrations/20261029184629_mammography_optional_not_duplicate_of_breast_imaging.sql"),
      "utf8",
    );
    expect(sql).toMatch(/set is_optional = true where code = 'mammography'/);
  });
});

import {
  ageInMonths,
  bandForPoint,
  buildChildVaccineChecklist,
  type ChartPointInput,
  type ScheduleCatalogRow,
  type ScheduleRecordRow,
} from "@tarragon/shared";
import type { ChildRecordData } from "./child-record-document";

export interface GrowthSourceRow {
  id: string;
  measured_at: string;
  weight_kg: number | null;
  height_cm: number | null;
  weight_for_age_z: number | null;
  height_for_age_z: number | null;
  weight_for_height_z: number | null;
  nutrition_class: string | null;
  plausibility_flags: string[] | null;
}

/** Pure: turns the caller's own reads into the page data. The band is the database's z-score through the same words as the screen. */
export function buildChildRecord(input: {
  name: string;
  dateOfBirth: string | null;
  sex: "male" | "female" | null;
  today: string;
  generatedAt: string;
  growth: readonly GrowthSourceRow[];
  catalog: readonly ScheduleCatalogRow[];
  records: readonly ScheduleRecordRow[];
}): ChildRecordData {
  const results = input.growth.map((r) => ({
    row: r,
    result: bandForPoint({
      weightForAgeZ: r.weight_for_age_z,
      heightForAgeZ: r.height_for_age_z,
      weightForHeightZ: r.weight_for_height_z,
      nutritionClass: r.nutrition_class === "severe_acute" || r.nutrition_class === "moderate_acute" || r.nutrition_class === "none" ? r.nutrition_class : null,
      implausible: (r.plausibility_flags ?? []).length > 0,
    }),
  }));
  const points = (pick: (r: GrowthSourceRow) => number | null): ChartPointInput[] =>
    results.flatMap(({ row, result }) => {
      const v = pick(row);
      if (v === null || !input.dateOfBirth) return [];
      return [{ id: row.id, ageMonths: ageInMonths(input.dateOfBirth, row.measured_at), value: v, band: result.kind === "band" ? result.band : null }];
    });
  const last = results[results.length - 1]?.result;
  return {
    name: input.name,
    dateOfBirth: input.dateOfBirth,
    generatedAt: input.generatedAt,
    weightPoints: points((r) => r.weight_kg),
    heightPoints: points((r) => r.height_cm),
    latestBand: last && last.kind === "band" ? last.band : null,
    doses: input.dateOfBirth
      ? buildChildVaccineChecklist({ dateOfBirth: input.dateOfBirth, sex: input.sex, today: input.today, catalog: input.catalog, records: input.records })
      : [],
  };
}

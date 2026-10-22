import { getProposedConfig } from "../proposed-config";

/**
 * Plain-language growth bands (S68b). The numbers are the database's WHO z-scores (child_growth_measurements, computed at write from the
 * versioned reference); this file only chooses a word. No model, no new threshold in code: the cut-offs are `child_log.growth_bands`, PROPOSED.
 * Each band carries a SHAPE and a WORD as well as a colour, so a person who cannot tell colours apart, or reads a greyscale print, loses nothing.
 */
export type GrowthBand = "growing_well" | "keep_an_eye_on" | "talk_to_care_team";
export const GROWTH_BAND_SHAPE: Readonly<Record<GrowthBand, "circle" | "diamond" | "triangle">> = {
  growing_well: "circle",
  keep_an_eye_on: "diamond",
  talk_to_care_team: "triangle",
};

export interface GrowthBandRules {
  readonly growing_well_max_abs_z: number;
  readonly keep_an_eye_max_abs_z: number;
}

export function growthBandRules(): { rules: GrowthBandRules; version: number } {
  const c = getProposedConfig<Record<string, number>>("child_log.growth_bands");
  return { rules: c.value as unknown as GrowthBandRules, version: c.version };
}

export interface GrowthPointInput {
  readonly weightForAgeZ: number | null;
  readonly heightForAgeZ: number | null;
  readonly weightForHeightZ: number | null;
  readonly nutritionClass: "severe_acute" | "moderate_acute" | "none" | null;
  /** The database found a value it considers biologically implausible: the point is not banded, the person is asked to re-check. */
  readonly implausible: boolean;
}

export type GrowthBandResult =
  | { readonly kind: "check_measurement" }
  | { readonly kind: "no_reference" }
  /** `recheck`: the database also flagged a value as implausible, so the screen adds "please check the measurement" beside the band. */
  | { readonly kind: "band"; readonly band: GrowthBand; readonly crisis: boolean; readonly recheck: boolean };

/**
 * One point, one band: the worst of the z-scores that exist. The database's own acute-nutrition class (MUAC, swelling, weight-for-height) always
 * wins: severe is "talk to your care team" AND a crisis, which the screen must lead with as "go to the nearest clinic now" and a call button;
 * moderate is "talk to your care team" without the crisis lead. The database KEEPS an implausible value and still routes it (S68d), so both classes
 * are read BEFORE the implausible branch: an implausible value only becomes "check the measurement" when the database routed nothing from it.
 * No z-score at all means the chart could not read it: the screen says that, it never invents "growing well".
 */
export function bandForPoint(p: GrowthPointInput, rules: GrowthBandRules = growthBandRules().rules): GrowthBandResult {
  const crisis = p.nutritionClass === "severe_acute";
  const moderate = p.nutritionClass === "moderate_acute";
  if (p.implausible) {
    if (crisis || moderate) return { kind: "band", band: "talk_to_care_team", crisis, recheck: true };
    return { kind: "check_measurement" };
  }
  const zs = [p.weightForAgeZ, p.heightForAgeZ, p.weightForHeightZ].filter((z): z is number => z !== null && Number.isFinite(z));
  if (zs.length === 0 && !moderate && !crisis) return { kind: "no_reference" };
  const worst = zs.length === 0 ? 0 : Math.max(...zs.map(Math.abs));
  let band: GrowthBand = worst <= rules.growing_well_max_abs_z ? "growing_well" : worst <= rules.keep_an_eye_max_abs_z ? "keep_an_eye_on" : "talk_to_care_team";
  if (crisis || moderate) band = "talk_to_care_team";
  return { kind: "band", band, crisis, recheck: false };
}

export type GrowthSeriesRow = GrowthPointInput & {
  readonly measuredAt: string;
  readonly muacMm?: number | null;
  readonly bilateralOedema?: boolean;
};

/** A row carries a nutrition-relevant reading when the database had something to classify: arm measurement, swelling, or weight-for-height. */
export function carriesNutritionReading(r: GrowthSeriesRow): boolean {
  return (r.muacMm !== null && r.muacMm !== undefined) || r.bilateralOedema === true || r.weightForHeightZ !== null;
}

/**
 * The result for the most recent measurement, with the acute-nutrition class CARRIED FORWARD. S68d classifies each row on its own and a row with no
 * arm measurement, swelling or weight-for-height (a weight-only re-weigh) is stored as "none", which is "nothing to classify", not "recovered". So the
 * class used is the latest row that carries a nutrition-relevant reading; a weight-only row cannot clear a severe or moderate result. Shared by the
 * phone, the web and the PDF so all three lead the same way.
 */
export function latestBand(points: readonly GrowthSeriesRow[], rules?: GrowthBandRules): GrowthBandResult | null {
  const sorted = [...points].sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt));
  const last = sorted[0];
  if (!last) return null;
  const carrier = carriesNutritionReading(last) ? last : sorted.find(carriesNutritionReading);
  return bandForPoint(carrier && carrier !== last ? { ...last, nutritionClass: carrier.nutritionClass } : last, rules);
}

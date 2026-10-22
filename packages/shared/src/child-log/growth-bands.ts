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
  | { readonly kind: "band"; readonly band: GrowthBand; readonly crisis: boolean };

/**
 * One point, one band: the worst of the z-scores that exist. The database's own acute-nutrition class (MUAC, swelling, weight-for-height) always
 * wins: severe is "talk to your care team" AND a crisis, which the screen must lead with as "go to the nearest clinic now" and a call button;
 * moderate is "talk to your care team" without the crisis lead. No z-score at all means the chart could not read it: the screen says that,
 * it never invents "growing well".
 */
export function bandForPoint(p: GrowthPointInput, rules: GrowthBandRules = growthBandRules().rules): GrowthBandResult {
  if (p.implausible) return { kind: "check_measurement" };
  const crisis = p.nutritionClass === "severe_acute";
  const zs = [p.weightForAgeZ, p.heightForAgeZ, p.weightForHeightZ].filter((z): z is number => z !== null && Number.isFinite(z));
  if (zs.length === 0 && p.nutritionClass !== "moderate_acute" && !crisis) return { kind: "no_reference" };
  const worst = zs.length === 0 ? 0 : Math.max(...zs.map(Math.abs));
  let band: GrowthBand = worst <= rules.growing_well_max_abs_z ? "growing_well" : worst <= rules.keep_an_eye_max_abs_z ? "keep_an_eye_on" : "talk_to_care_team";
  if (crisis || p.nutritionClass === "moderate_acute") band = "talk_to_care_team";
  return { kind: "band", band, crisis };
}

/** The result for the most recent measurement in a series, or null for an empty series. */
export function latestBand(points: readonly (GrowthPointInput & { readonly measuredAt: string })[], rules?: GrowthBandRules): GrowthBandResult | null {
  const last = [...points].sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt))[0];
  return last ? bandForPoint(last, rules) : null;
}

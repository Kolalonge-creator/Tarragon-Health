/**
 * Cross-source de-duplication (S70a, acceptance test of Module 18). Pure mirror of the database resolver
 * (private.dedupe_cross_source_vitals) so the apps can explain a result and the rule can be tested without a database.
 *
 * Same patient, same vital type, from DIFFERENT sources, values inside tolerance, inside the time window: one canonical row, the other
 * linked and never deleted. The better source wins by precedence (validated Bluetooth device, vendor cloud, phone or aggregator mirror,
 * a photo the person confirmed, a typed entry). Two readings from the SAME source are never merged here (a CGM stream is many similar
 * values on purpose). Two values on either side of a triage band are never merged, so a merge cannot hide the worse reading.
 */
import { getProposedConfig } from "./proposed-config";

export type SourceClass = "ble_device" | "vendor_cloud" | "phone_mirror" | "photo_confirmed" | "manual";
export type DedupeVital = "blood_pressure" | "glucose" | "weight" | "pulse" | "spo2";

export interface DedupeConfig {
  tolerance: { systolic_mmhg: number; diastolic_mmhg: number; glucose_mmol_l: number; weight_kg: number; pulse_bpm: number; spo2_pct: number };
  window_minutes: Record<DedupeVital, number>;
  precedence: SourceClass[];
  mirror_providers: string[];
  glucose_band_edges_mmol_l: number[];
}

export function loadDedupeConfig(asOf?: string): { config: DedupeConfig; version: number } {
  const r = getProposedConfig("devices.dedupe", asOf);
  return { config: r.value as unknown as DedupeConfig, version: r.version };
}

export interface DedupeReading {
  vitalType: string;
  /** vitals_readings.source */
  source: string;
  /** Provider of the wearable connection when source is "wearable" (apple_health and android_health_connect are mirrors). */
  provider?: string | null;
  /** Which concrete device or connection produced it, so two different sources of one class still count as different. */
  sourceKey: string;
  takenAt: string;
  systolic?: number | null;
  diastolic?: number | null;
  glucoseMmolL?: number | null;
  weightKg?: number | null;
  pulseBpm?: number | null;
  spo2Pct?: number | null;
}

/** null means "never de-duplicated" (fhir_import, unknown). */
export function sourceClassOf(r: Pick<DedupeReading, "source" | "provider">, cfg: DedupeConfig = loadDedupeConfig().config): SourceClass | null {
  switch (r.source) {
    case "device":
      return "ble_device";
    case "cgm":
      return "vendor_cloud";
    case "wearable":
      // the phone health bridges write a wearable reading with no connection and so no provider: that is a mirror too
      return !r.provider || cfg.mirror_providers.includes(r.provider) ? "phone_mirror" : "vendor_cloud";
    case "photo_confirmed":
      return "photo_confirmed";
    case "manual":
      return "manual";
    default:
      return null;
  }
}

export function rankOf(cls: SourceClass, cfg: DedupeConfig = loadDedupeConfig().config): number {
  const i = cfg.precedence.indexOf(cls);
  return i === -1 ? cfg.precedence.length : i;
}

const bandOfGlucose = (v: number, edges: number[]): number => edges.filter((e) => v >= e).length;

export interface DedupeDecision {
  duplicate: boolean;
  /** Which of the two stays the canonical row; "a" wins ties (the earlier arrival keeps its place). */
  canonical: "a" | "b";
  reason?: "same_source" | "not_deduplicated_source" | "other_vital" | "outside_window" | "outside_tolerance" | "different_triage_band" | "no_tolerance";
}

/**
 * `bandOf` supplies a triage-band number for BP, pulse and SpO2. In the database these are the live classifiers
 * (classify_bp_level and so on); callers outside the database that cannot reach them may omit it, which is only safe for explanation, never for storage.
 */
export function resolveDuplicate(
  a: DedupeReading,
  b: DedupeReading,
  bandOf?: (r: DedupeReading) => string | number | null,
  loaded = loadDedupeConfig(),
): DedupeDecision {
  const { config: cfg } = loaded;
  const keep = (reason: NonNullable<DedupeDecision["reason"]>): DedupeDecision => ({ duplicate: false, canonical: "a", reason });
  if (a.vitalType !== b.vitalType) return keep("other_vital");
  const clsA = sourceClassOf(a, cfg);
  const clsB = sourceClassOf(b, cfg);
  if (!clsA || !clsB) return keep("not_deduplicated_source");
  if (clsA === clsB && a.sourceKey === b.sourceKey) return keep("same_source");
  const windowMin = (cfg.window_minutes as Record<string, number | undefined>)[a.vitalType];
  if (windowMin === undefined) return keep("no_tolerance");
  const gapMs = Math.abs(Date.parse(a.takenAt) - Date.parse(b.takenAt));
  if (!(gapMs <= windowMin * 60_000)) return keep("outside_window");

  const t = cfg.tolerance;
  const near = (x: number | null | undefined, y: number | null | undefined, tol: number): boolean => x != null && y != null && Math.abs(x - y) <= tol + 1e-9;
  let within = false;
  switch (a.vitalType) {
    case "blood_pressure":
      within = near(a.systolic, b.systolic, t.systolic_mmhg) && near(a.diastolic, b.diastolic, t.diastolic_mmhg);
      break;
    case "glucose":
      within = near(a.glucoseMmolL, b.glucoseMmolL, t.glucose_mmol_l);
      if (within && bandOfGlucose(a.glucoseMmolL as number, cfg.glucose_band_edges_mmol_l) !== bandOfGlucose(b.glucoseMmolL as number, cfg.glucose_band_edges_mmol_l)) {
        return keep("different_triage_band");
      }
      break;
    case "weight":
      within = near(a.weightKg, b.weightKg, t.weight_kg);
      break;
    case "pulse":
      within = near(a.pulseBpm, b.pulseBpm, t.pulse_bpm);
      break;
    case "spo2":
      within = near(a.spo2Pct, b.spo2Pct, t.spo2_pct);
      break;
    default:
      return keep("no_tolerance");
  }
  if (!within) return keep("outside_tolerance");
  if (bandOf && a.vitalType !== "glucose" && a.vitalType !== "weight") {
    if (bandOf(a) !== bandOf(b)) return keep("different_triage_band");
  }
  return { duplicate: true, canonical: rankOf(clsB, cfg) < rankOf(clsA, cfg) ? "b" : "a" };
}

/** Human label for the source badge shown on every reading in every screen (18.9). */
export const SOURCE_BADGE_LABEL: Record<string, string> = {
  manual: "Typed by you",
  device: "From your device",
  wearable: "Wearable estimate",
  cgm: "From your glucose sensor",
  fhir_import: "Imported record",
  photo_confirmed: "Photo, confirmed by you",
};

export function sourceBadgeLabel(source: string | null | undefined): string {
  if (!source) return SOURCE_BADGE_LABEL.manual as string;
  return SOURCE_BADGE_LABEL[source] ?? "Other source";
}

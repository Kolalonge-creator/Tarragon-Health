import { displayCode, parseTrend, type TrendSeries } from "@tarragon/shared";
import { t } from "@tarragon/i18n";
import { supabase } from "./supabase";
import { readThrough, type ReadResult } from "./passport-cache";

/**
 * Results over time (S43, spec 2.5) on the phone. The database returns only results the person may see (released, not withdrawn, never a
 * sensitive positive) with the laboratory's own range on each; the parsing and the grouping by unit are the web's, shared through
 * @tarragon/shared. Nothing here invents a range, converts a unit or says what a result means.
 *
 * Only the person's own results are kept for offline reading. A supporter reads live: the person can withdraw access.
 */
export interface BiomarkerListItem {
  code: string;
  readings: number;
  lastAt: string;
  latestValue: number | null;
  latestUnit: string | null;
}

export const biomarkerListKey = (subjectId: string) => `bio:list:${subjectId}`;
export const biomarkerTrendKey = (subjectId: string, code: string) => `bio:trend:${subjectId}:${code}`;

export function parseBiomarkerList(data: unknown): BiomarkerListItem[] {
  if (!Array.isArray(data)) return [];
  const out: BiomarkerListItem[] = [];
  for (const raw of data as Record<string, unknown>[]) {
    if (!raw || typeof raw.code !== "string" || typeof raw.last_at !== "string") continue;
    const readings = typeof raw.readings === "number" ? raw.readings : Number(raw.readings);
    if (!Number.isFinite(readings)) continue;
    const latest = raw.latest_value === null || raw.latest_value === undefined ? null : Number(raw.latest_value);
    out.push({
      code: raw.code,
      readings,
      lastAt: raw.last_at,
      latestValue: latest !== null && Number.isFinite(latest) ? latest : null,
      latestUnit: typeof raw.latest_unit === "string" && raw.latest_unit.trim() !== "" ? raw.latest_unit : null,
    });
  }
  return out;
}

export function loadBiomarkerList(subjectId: string, own: boolean): Promise<ReadResult<BiomarkerListItem[]>> {
  return readThrough(
    biomarkerListKey(subjectId),
    async () => {
      const { data, error } = await supabase.rpc("patient_biomarker_list", { p_patient: subjectId });
      if (error) return { ok: false, error };
      return { ok: true, data: parseBiomarkerList(data) };
    },
    { keep: own }
  );
}

/** One test across the years, parsed by the shared rules. A malformed answer parses to null and is shown as no results, never as a made-up line. */
export function loadBiomarkerTrend(subjectId: string, code: string, own: boolean): Promise<ReadResult<TrendSeries | null>> {
  return readThrough(
    biomarkerTrendKey(subjectId, code),
    async () => {
      const { data, error } = await supabase.rpc("patient_biomarker_trend", { p_code: code, p_patient: subjectId });
      if (error) return { ok: false, error };
      return { ok: true, data: parseTrend(data) };
    },
    { keep: own }
  );
}

/** The one sentence a screen reader gets in place of the drawing. The table under the chart carries every value. */
export function trendSummary(code: string, unit: string | null, points: readonly { takenAt: string }[]): string {
  const first = points[0]?.takenAt;
  const last = points[points.length - 1]?.takenAt;
  const count = points.length;
  return t(count === 1 ? "mpass.bio.summary_one" : "mpass.bio.summary_other", "en", {
    name: displayCode(code),
    count: String(count),
    unit: unit ? ` in ${unit}` : "",
    from: String(first ? new Date(first).getFullYear() : ""),
    to: String(last ? new Date(last).getFullYear() : ""),
  });
}

/** "5.4 mmol/L" for the chip under a test name. Null when the lab sent no number. */
export function latestLabel(item: Pick<BiomarkerListItem, "latestValue" | "latestUnit">): string | null {
  if (item.latestValue === null) return null;
  return `${item.latestValue}${item.latestUnit ? ` ${item.latestUnit}` : ""}`;
}

export function readingsLabel(count: number): string {
  return t(count === 1 ? "mpass.bio.readings_one" : "biomarkers.readings", "en", { count: String(count) });
}


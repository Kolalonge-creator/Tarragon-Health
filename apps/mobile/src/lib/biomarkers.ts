import { displayCode, parseTrend, type TrendSeries } from "@tarragon/shared";
import { en, t, type MessageKey } from "@tarragon/i18n";
import { supabase } from "./supabase";
import { cacheDeleteExcept, readThrough, type ReadResult } from "./passport-cache";
import { formatPassportYear } from "./passport-format";

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
    if (!Number.isInteger(readings) || readings < 1 || Number.isNaN(Date.parse(raw.last_at))) continue;
    // A blank or a boolean is not a number (Number("") is 0 and would show as a real result).
    const lv = raw.latest_value;
    const latest = typeof lv === "number" || (typeof lv === "string" && lv.trim() !== "") ? Number(lv) : null;
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

export async function loadBiomarkerList(subjectId: string, own: boolean): Promise<ReadResult<BiomarkerListItem[]>> {
  const result = await readListThrough(subjectId, own);
  // A fresh list is the truth about which tests exist: a saved trend for a test that is gone (every result withdrawn) is removed, not kept readable offline.
  if (own && result.ok && !result.stale) {
    await cacheDeleteExcept(
      `bio:trend:${subjectId}:`,
      result.data.map((i) => biomarkerTrendKey(subjectId, i.code))
    );
  }
  return result;
}

function readListThrough(subjectId: string, own: boolean): Promise<ReadResult<BiomarkerListItem[]>> {
  return readThrough(
    biomarkerListKey(subjectId),
    async () => {
      const { data, error } = await supabase.rpc("patient_biomarker_list", { p_patient: subjectId });
      if (error) return { ok: false, error };
      // An answer of the wrong shape is a failed read (the saved copy is kept and shown), not "no results".
      if (!Array.isArray(data)) return { ok: false, error: { message: "unexpected answer" } };
      const rows = parseBiomarkerList(data);
      // Rows that all failed to parse are a changed shape, not an empty record: never saved over a good copy as "none".
      if (data.length > 0 && rows.length === 0) return { ok: false, error: { message: "unexpected answer" } };
      return { ok: true, data: rows };
    },
    { keep: own }
  );
}

/** One test across the years, parsed by the shared rules. A malformed answer is a failed read, never a made-up line and never "no results". */
export function loadBiomarkerTrend(subjectId: string, code: string, own: boolean): Promise<ReadResult<TrendSeries>> {
  return readThrough(
    biomarkerTrendKey(subjectId, code),
    async () => {
      const { data, error } = await supabase.rpc("patient_biomarker_trend", { p_code: code, p_patient: subjectId });
      if (error) return { ok: false, error };
      const series = parseTrend(data);
      const rawPoints = (data as { points?: unknown } | null)?.points;
      if (!series || !Array.isArray(rawPoints) || (rawPoints.length > 0 && series.points.length === 0)) return { ok: false, error: { message: "unexpected answer" } };
      return { ok: true, data: series };
    },
    { keep: own }
  );
}

/** The one sentence a screen reader gets in place of the drawing. The list under the chart carries every value. */
export function trendSummary(code: string, unit: string | null, points: readonly { takenAt: string }[]): string {
  const count = points.length;
  const key: MessageKey = `mpass.bio.summary_${count === 1 ? "one" : "other"}${unit ? "_unit" : ""}` as MessageKey;
  return t(key, "en", {
    name: displayCode(code),
    count: String(count),
    unit: unit ?? "",
    from: formatPassportYear(points[0]?.takenAt),
    to: formatPassportYear(points[count - 1]?.takenAt),
  });
}

/**
 * What a result's flag says, in words. The database allows more flags than the web page had words for (critical, positive, negative, abnormal),
 * and a flag with no words must never read as "within range": anything unknown but not normal says it is outside the laboratory's range.
 * "normal" says nothing.
 */
export function flagLabel(flag: string | null | undefined): string | null {
  if (!flag || flag === "normal") return null;
  const key = `biomarkers.flag.${flag}`;
  if (Object.hasOwn(en, key)) return t(key as MessageKey);
  const own = `mpass.bio.flag.${flag}`;
  return Object.hasOwn(en, own) ? t(own as MessageKey) : t("mpass.bio.flag.other");
}

/** "5.4 mmol/L" for the chip under a test name. Null when the lab sent no number. */
export function latestLabel(item: Pick<BiomarkerListItem, "latestValue" | "latestUnit">): string | null {
  if (item.latestValue === null) return null;
  return `${formatResultValue(item.latestValue)}${item.latestUnit ? ` ${item.latestUnit}` : ""}`;
}

/** A result as plain digits: a very small or very large value never prints in exponent form (1e-7). */
export function formatResultValue(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("en-GB", { useGrouping: false, maximumFractionDigits: 20 });
}

export function readingsLabel(count: number): string {
  return t(count === 1 ? "mpass.bio.readings_one" : "biomarkers.readings", "en", { count: String(count) });
}

/**
 * Who a reading came from, in words. A number the person confirmed themselves from their own uploaded report (source patient_reported) is
 * never called a laboratory result: nobody has checked it, and it carries no laboratory name even if one were present. Everything else
 * keeps the laboratory's own name when it sent one.
 */
export function readingSourceLabel(p: { source: string; laboratory: string | null }): string {
  if (p.source === "patient_reported") return t("biomarkers.source.patient_reported" as MessageKey);
  if (p.laboratory) return p.laboratory;
  return t((p.source === "legacy_report" ? "biomarkers.source.legacy_report" : "biomarkers.source.lab_result") as MessageKey);
}

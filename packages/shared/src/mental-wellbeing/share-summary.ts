/**
 * The "Share with my care team" summary (S56b, function 1): the shape the database builds, a defensive reader, and one formatter that web, phone and
 * the clinician's view all use, so the preview a patient approves and what the care team reads are the same words.
 *
 * What is in it (and nothing else): the raw totals of the latest PHQ-9 and GAD-7 with the band the signed instrument already stored and the raw
 * change since the one before; weekly means of mood and stress; sleep diary highlights; the patient's own note. The private journal, the
 * answers to individual questionnaire items, check-in notes and tags are never in it (the database builder cannot reach them).
 */
import { getProposedConfig } from "../proposed-config";

export type ShareSummaryConfig = {
  readonly version: number;
  readonly screen_points: number;
  readonly checkin_weeks: number;
  readonly sleep_days: number;
  readonly note_max_chars: number;
}
export const shareSummaryConfig = (): ShareSummaryConfig => getProposedConfig<ShareSummaryConfig>("wellbeing.share_summary").value;

export interface SummaryScorePoint { readonly at: string; readonly total: number; readonly band: string }
export interface SummaryScreen { readonly instrument: "phq9" | "gad7"; readonly points: readonly SummaryScorePoint[]; readonly changeSincePrevious: number | null }
export interface SummaryCheckinWeek { readonly weekStart: string; readonly checkIns: number; readonly moodMean: number | null; readonly stressMean: number | null }
export interface SummarySleep {
  readonly days: number;
  readonly entries: number;
  readonly meanHours: number | null;
  readonly shortestHours: number | null;
  readonly longestHours: number | null;
  readonly meanQuality: number | null;
  readonly meanMinutesToFallAsleep: number | null;
  readonly meanNightWakings: number | null;
}
export interface WellbeingSummary {
  readonly screens: readonly SummaryScreen[] | null;
  readonly checkIns: readonly SummaryCheckinWeek[] | null;
  readonly sleep: SummarySleep | null | "empty";
}

export interface SummaryChoices { readonly screens: boolean; readonly checkins: boolean; readonly sleep: boolean; readonly note: string }
/** Nothing is chosen until the patient chooses it. */
export const NOTHING_CHOSEN: SummaryChoices = { screens: false, checkins: false, sleep: false, note: "" };
export const hasAnyChoice = (c: SummaryChoices): boolean => c.screens || c.checkins || c.sleep || c.note.trim().length > 0;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** Reads the database's summary object. Anything unexpected is left out rather than guessed at. */
export function parseWellbeingSummary(raw: unknown): WellbeingSummary {
  const o = isObj(raw) ? raw : {};
  let screens: SummaryScreen[] | null = null;
  if (Array.isArray(o.screens)) {
    screens = [];
    for (const s of o.screens) {
      if (!isObj(s) || (s.instrument !== "phq9" && s.instrument !== "gad7") || !Array.isArray(s.points)) continue;
      const points: SummaryScorePoint[] = [];
      for (const p of s.points) {
        if (isObj(p) && typeof p.at === "string" && num(p.total) !== null && typeof p.band === "string") points.push({ at: p.at, total: num(p.total) as number, band: p.band });
      }
      screens.push({ instrument: s.instrument, points, changeSincePrevious: num(s.change_since_previous) });
    }
  }
  let checkIns: SummaryCheckinWeek[] | null = null;
  if (Array.isArray(o.check_ins)) {
    checkIns = [];
    for (const w of o.check_ins) {
      if (isObj(w) && typeof w.week_start === "string") checkIns.push({ weekStart: w.week_start, checkIns: num(w.check_ins) ?? 0, moodMean: num(w.mood_mean), stressMean: num(w.stress_mean) });
    }
  }
  let sleep: WellbeingSummary["sleep"] = null;
  if (isObj(o.sleep)) {
    const s = o.sleep;
    sleep = num(s.entries) === null
      ? "empty"
      : {
          days: num(s.days) ?? 0, entries: num(s.entries) as number, meanHours: num(s.mean_hours), shortestHours: num(s.shortest_hours), longestHours: num(s.longest_hours),
          meanQuality: num(s.mean_quality), meanMinutesToFallAsleep: num(s.mean_minutes_to_fall_asleep), meanNightWakings: num(s.mean_night_wakings),
        };
  }
  return { screens, checkIns, sleep };
}

export const INSTRUMENT_LABEL: Record<"phq9" | "gad7", string> = { phq9: "PHQ-9", gad7: "GAD-7" };

const DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
const dateOf = (iso: string): string => {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00+01:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : DATE.format(d);
};
const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

export interface SummarySection { readonly heading: string; readonly lines: readonly string[] }

/**
 * The words of a summary, section by section. `translate` is the i18n `t` for the viewer; `note` is the patient's own text (shown as written).
 * Used for the preview, the on-screen "read aloud" view and the clinician's reading, so they cannot differ.
 */
export function summarySections(
  summary: WellbeingSummary,
  note: string | null,
  translate: (key: string, params?: Record<string, string | number>) => string,
): SummarySection[] {
  const out: SummarySection[] = [];
  if (summary.screens !== null) {
    const lines: string[] = [];
    for (const s of summary.screens) {
      for (const p of s.points) {
        lines.push(translate("wsum.score_line", { instrument: INSTRUMENT_LABEL[s.instrument], total: p.total, date: dateOf(p.at) }));
        lines.push(translate("wsum.score_band", { band: p.band }));
      }
      if (s.changeSincePrevious !== null) lines.push(`${INSTRUMENT_LABEL[s.instrument]}: ${translate("wsum.change_line", { change: signed(s.changeSincePrevious) })}`);
    }
    out.push({ heading: translate("wsum.screens_heading"), lines: lines.length > 0 ? [...lines, translate("wsum.scores_note")] : [translate("wsum.no_entries")] });
  }
  if (summary.checkIns !== null) {
    const lines = summary.checkIns.map((w) => translate("wsum.checkin_row", { date: dateOf(w.weekStart), mood: w.moodMean ?? "-", stress: w.stressMean ?? "-", n: w.checkIns }));
    out.push({ heading: translate("wsum.checkins_heading"), lines: lines.length > 0 ? lines : [translate("wsum.no_entries")] });
  }
  if (summary.sleep !== null) {
    if (summary.sleep === "empty") {
      out.push({ heading: translate("wsum.sleep_heading"), lines: [translate("wsum.no_entries")] });
    } else {
      const s = summary.sleep;
      const lines = [translate("wsum.sleep_entries", { n: s.entries, days: s.days })];
      if (s.meanHours !== null) lines.push(translate("wsum.sleep_mean", { hours: s.meanHours, min: s.shortestHours ?? "-", max: s.longestHours ?? "-" }));
      if (s.meanQuality !== null) lines.push(translate("wsum.sleep_quality", { quality: s.meanQuality }));
      if (s.meanMinutesToFallAsleep !== null) lines.push(translate("wsum.sleep_latency", { minutes: s.meanMinutesToFallAsleep }));
      if (s.meanNightWakings !== null) lines.push(translate("wsum.sleep_wakings", { n: s.meanNightWakings }));
      out.push({ heading: translate("wsum.sleep_heading"), lines });
    }
  }
  if (note !== null && note.trim() !== "") out.push({ heading: translate("wsum.note_heading"), lines: [note.trim()] });
  return out;
}

/** The preview the database returns: the summary and a hash of it. The send carries the hash, so what was previewed is what is sent. */
export function parseSummaryPreview(raw: unknown): { summary: WellbeingSummary; hash: string } | null {
  if (!isObj(raw) || typeof raw.hash !== "string" || raw.hash === "" || !isObj(raw.summary)) return null;
  return { summary: parseWellbeingSummary(raw.summary), hash: raw.hash };
}

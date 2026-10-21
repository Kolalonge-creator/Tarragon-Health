import { assessHomeCheck, addLocalDays, type HomeBpConfig, type HomeBpReading } from "@tarragon/clinical";
import { diagnosticBpReadings } from "@tarragon/shared";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";

/**
 * "Bring this to your visit" (S07y): the patient-held summary of the last 7 days, handed to a clinician.
 * Pure: strings come from the catalogue, nothing reads a clock or a database here.
 *
 * - Blood pressure: the 7-day home average only when a SIGNED home programme exists and its own gate is met (the same `assessHomeCheck` the phone card uses, so the same
 *   numbers); otherwise the plain "not enough readings yet" with what is missing. Never graded, never labelled "controlled", never compared with a band.
 *   Wearable estimates are left out (`diagnosticBpReadings`), as everywhere an average is made.
 * - Medicines: doses the patient marked taken (taken plus late, as S08x counts them), as the same percentage `private.weekly_adherence` gives the app, and
 *   only when that function gave one (three doses due or more). No grade, no colour.
 * - Symptoms: the ones the patient herself ticked, by day. No severity is invented.
 * It holds no laboratory result, no clinician-only flag and no clinic reading.
 */
export interface VisitBpRow {
  systolic: number | null;
  diastolic: number | null;
  taken_at: string;
  source?: string | null;
}

export interface VisitAdherence {
  due: number;
  taken: number;
  late: number;
  /** Null when fewer doses were due than the minimum (the server decides). */
  percent: number | null;
}

export interface VisitSymptomRow {
  code: string;
  reported_at: string;
}

export interface BpVisitSummary {
  title: string;
  subtitle: string;
  intro: string;
  bpHeading: string;
  bpLines: string[];
  medHeading: string;
  medLine: string;
  symHeading: string;
  symLines: string[];
  footer: string;
}

const LAGOS = "Africa/Lagos";

function lagosDateKey(ms: number): string {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: LAGOS, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

function prettyDate(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: LAGOS, day: "numeric", month: "short", year: "numeric" }).format(new Date(ms));
}

/** Parses the jsonb the adherence function returns; null when it is not the expected shape (the route then refuses rather than show zeros). */
export function parseVisitAdherence(raw: unknown): VisitAdherence | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const num = (k: string): number | null => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : null);
  if (r["status"] !== "ok") return null;
  const due = num("due");
  const taken = num("taken");
  const late = num("late");
  if (due === null || taken === null || late === null) return null;
  const percent = r["percent"] === null ? null : num("percent");
  if (r["percent"] !== null && percent === null) return null;
  return { due, taken, late, percent };
}

function humaniseCode(code: string): string {
  return code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function buildBpVisitSummary(args: {
  patientName: string;
  nowMs: number;
  readings: readonly VisitBpRow[];
  /** The SIGNED home programme values; null when none is signed (or it could not be read), and then no average is shown at all (INV-16). */
  programme: HomeBpConfig | null;
  adherence: VisitAdherence;
  symptoms: readonly VisitSymptomRow[];
  locale?: Locale;
}): BpVisitSummary {
  const locale = args.locale ?? "en";
  const today = lagosDateKey(args.nowMs);
  const startDate = addLocalDays(today, -6);

  const usable = diagnosticBpReadings(args.readings).flatMap((r): HomeBpReading[] => {
    const atMs = Date.parse(r.taken_at);
    return r.systolic === null || r.diastolic === null || Number.isNaN(atMs) ? [] : [{ systolic: r.systolic, diastolic: r.diastolic, atMs }];
  });
  const a = args.programme ? assessHomeCheck({ readings: usable, startDate, nowMs: args.nowMs }, args.programme) : null;

  const bpLines: string[] = [];
  if (!a || !args.programme) {
    bpLines.push(t("visit.bp.unavailable", locale));
  } else if (a.mean) {
    bpLines.push(t("visit.bp.average", locale, { readings: a.readings, days: a.days, sys: a.mean.systolic, dia: a.mean.diastolic }));
  } else if (a.readings === 0) {
    bpLines.push(t("visit.bp.none", locale));
  } else {
    bpLines.push(
      t("visit.bp.not_enough", locale, { readings: a.readings, days: a.days, minReadings: args.programme.protocol.minReadings, minDays: args.programme.protocol.minDays }),
    );
  }

  const d = args.adherence;
  const markedTaken = d.taken + d.late;
  const medLine =
    d.due === 0
      ? t("visit.med.none", locale)
      : d.percent === null
        ? t("visit.med.few", locale)
        : t("visit.med.taken", locale, { taken: markedTaken, due: d.due, pct: d.percent });

  // One line per day and symptom, newest first, only inside the same 7 Lagos days.
  const seen = new Set<string>();
  const symLines = [...args.symptoms]
    .map((s) => ({ ms: Date.parse(s.reported_at), code: s.code }))
    .filter((s) => !Number.isNaN(s.ms) && lagosDateKey(s.ms) >= startDate && lagosDateKey(s.ms) <= today)
    .sort((x, y) => y.ms - x.ms)
    .filter((s) => {
      const key = `${lagosDateKey(s.ms)}|${s.code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((s) => {
      const key = `vitals.symptom.${s.code}` as MessageKey;
      const label = t(key, locale);
      return t("visit.sym.line", locale, { date: prettyDate(s.ms), symptom: label === key ? humaniseCode(s.code) : label });
    });
  if (symLines.length === 0) symLines.push(t("visit.sym.none", locale));

  return {
    title: t("visit.title", locale),
    subtitle: t("visit.subtitle", locale, { name: args.patientName, date: prettyDate(args.nowMs) }),
    intro: t("visit.intro", locale),
    bpHeading: t("visit.bp.heading", locale),
    bpLines,
    medHeading: t("visit.med.heading", locale),
    medLine,
    symHeading: t("visit.sym.heading", locale),
    symLines,
    footer: t("visit.footer", locale),
  };
}

/**
 * Health status by domain (Tarragon Health 2.0, decision T2-06). Replaces the composite Health Score in the patient UI, web and mobile.
 *
 * Pure and deterministic: it turns the answer of public.patient_health_status() into six clinically meaningful domains, each with
 * transparent indicators (latest value, unit, date, the range the laboratory printed or the person's own target, a flag), the direction
 * since the previous result, and outstanding actions. There is deliberately NO number score: the founder brief rules out an arbitrary
 * composite (such as 85/100) until one has been clinically validated. A domain with nothing behind it is left out ("only show relevant
 * domains"), never shown as a fabricated all-clear. The status word compares a value with its own printed range or the person's own
 * target only; it never names a diagnosis, and every surface that shows it says it does not replace a doctor's assessment.
 */
import { getProposedConfig } from "./proposed-config";

export type HealthStatusDomainKey = "cardiometabolic" | "metabolic" | "renal" | "haematological" | "screening" | "lifestyle";

export type IndicatorFlag = "in_range" | "above" | "below" | "no_range";
export type IndicatorTrend = "up" | "down" | "same" | "first";

export interface HealthStatusIndicator {
  key: string;
  label: string;
  /** The latest value as printed, already rounded for display. */
  value: string;
  unit: string | null;
  /** ISO timestamp of the latest result or reading. */
  at: string;
  /** The range or target the value is compared with, in words, or null when the report printed none. */
  rangeText: string | null;
  flag: IndicatorFlag;
  trend: IndicatorTrend;
  /** The previous value in the same unit, as printed, for "up from 6.7". */
  previousValue: string | null;
  previousAt: string | null;
}

export interface HealthStatusDomain {
  key: HealthStatusDomainKey;
  label: string;
  blurb: string;
  /** "worth_discussing" when at least one indicator is outside its own range or target, or a screening is overdue. Never a score. */
  status: "within_range" | "worth_discussing" | "not_enough_yet";
  indicators: HealthStatusIndicator[];
  actions: string[];
}

export interface HealthStatusInput {
  labs?: unknown;
  vitals?: unknown;
  screening?: unknown;
}

export const HEALTH_STATUS_DISCLAIMER = "This shows your own results against the range printed on each report or your own target. It does not replace a doctor's assessment.";

export const HEALTH_STATUS_DOMAIN_ORDER: readonly HealthStatusDomainKey[] = ["cardiometabolic", "metabolic", "renal", "haematological", "screening", "lifestyle"];

const DOMAIN_META: Record<HealthStatusDomainKey, { label: string; blurb: string }> = {
  cardiometabolic: { label: "Heart and circulation", blurb: "Blood pressure and cholesterol." },
  metabolic: { label: "Blood sugar and liver", blurb: "HbA1c, glucose and liver tests." },
  renal: { label: "Kidneys", blurb: "Kidney function and the salts your kidneys balance." },
  haematological: { label: "Blood count", blurb: "Haemoglobin, white cells and platelets." },
  screening: { label: "Screening", blurb: "The checks your plan says are due." },
  lifestyle: { label: "Weight and waist", blurb: "Weight, body mass index and waist size." },
};

/** Which analyte code feeds which domain. A code not listed is left out of this view (it stays on the results page). */
const LAB_DOMAIN: Record<string, { domain: HealthStatusDomainKey; label: string }> = {
  total_cholesterol: { domain: "cardiometabolic", label: "Total cholesterol" },
  ldl_cholesterol: { domain: "cardiometabolic", label: "LDL cholesterol" },
  hdl_cholesterol: { domain: "cardiometabolic", label: "HDL cholesterol" },
  triglycerides: { domain: "cardiometabolic", label: "Triglycerides" },
  hba1c: { domain: "metabolic", label: "HbA1c" },
  fasting_glucose: { domain: "metabolic", label: "Fasting glucose" },
  random_glucose: { domain: "metabolic", label: "Random glucose" },
  alt: { domain: "metabolic", label: "ALT (liver)" },
  ast: { domain: "metabolic", label: "AST (liver)" },
  ggt: { domain: "metabolic", label: "GGT (liver)" },
  alp: { domain: "metabolic", label: "ALP (liver)" },
  bilirubin: { domain: "metabolic", label: "Bilirubin" },
  albumin: { domain: "metabolic", label: "Albumin" },
  creatinine: { domain: "renal", label: "Creatinine" },
  egfr: { domain: "renal", label: "eGFR" },
  urea: { domain: "renal", label: "Urea" },
  potassium: { domain: "renal", label: "Potassium" },
  sodium: { domain: "renal", label: "Sodium" },
  uacr: { domain: "renal", label: "Urine albumin to creatinine ratio" },
  urine_acr: { domain: "renal", label: "Urine albumin to creatinine ratio" },
  haemoglobin: { domain: "haematological", label: "Haemoglobin" },
  wbc: { domain: "haematological", label: "White cell count" },
  platelets: { domain: "haematological", label: "Platelets" },
  pcv: { domain: "haematological", label: "Packed cell volume" },
  mcv: { domain: "haematological", label: "Mean cell volume" },
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** Display a value with no trailing zeros, at most two decimals: 8.0000 -> "8", 7.30 -> "7.3". */
export function displayNumber(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function trendOf(latest: number, previous: number | null): IndicatorTrend {
  if (previous === null) return "first";
  if (latest > previous) return "up";
  if (latest < previous) return "down";
  return "same";
}

function flagFromRange(value: number, low: number | null, high: number | null): IndicatorFlag {
  if (low === null && high === null) return "no_range";
  if (high !== null && value > high) return "above";
  if (low !== null && value < low) return "below";
  return "in_range";
}

function flagFromText(flag: string | null): IndicatorFlag | null {
  if (!flag) return null;
  const f = flag.toLowerCase();
  if (f === "normal" || f === "n") return "in_range";
  if (f.includes("high") || f === "h" || f === "hh") return "above";
  if (f.includes("low") || f === "l" || f === "ll") return "below";
  return null;
}

function rangeWords(low: number | null, high: number | null, text: string | null, unit: string | null): string | null {
  const u = unit ? ` ${unit}` : "";
  if (low !== null && high !== null) return `${displayNumber(low)} to ${displayNumber(high)}${u}`;
  if (high !== null) return `up to ${displayNumber(high)}${u}`;
  if (low !== null) return `${displayNumber(low)}${u} or more`;
  return text;
}

function labIndicator(row: Record<string, unknown>): { domain: HealthStatusDomainKey; indicator: HealthStatusIndicator } | null {
  const code = str(row.code)?.toLowerCase();
  if (!code) return null;
  const meta = LAB_DOMAIN[code];
  if (!meta) return null;
  if (row.disputed === true) return null; // a value the patient has disputed is not shown as a status
  const latest = num(row.latest_value);
  const at = str(row.latest_at);
  if (latest === null || !at) return null;
  const unit = str(row.latest_unit);
  const low = num(row.ref_low), high = num(row.ref_high);
  const prevUnit = str(row.previous_unit);
  const previous = prevUnit === unit ? num(row.previous_value) : null; // never compare across units
  const flag = flagFromRange(latest, low, high) === "no_range" ? flagFromText(str(row.flag)) ?? "no_range" : flagFromRange(latest, low, high);
  return {
    domain: meta.domain,
    indicator: {
      key: code,
      label: meta.label,
      value: displayNumber(latest),
      unit,
      at,
      rangeText: rangeWords(low, high, str(row.ref_text), unit),
      flag,
      trend: trendOf(latest, previous),
      previousValue: previous === null ? null : displayNumber(previous),
      previousAt: previous === null ? null : str(row.previous_at),
    },
  };
}

function firstTwo(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter(isObj).slice(0, 2) : [];
}

function vitalsIndicators(vitals: Record<string, unknown>): { cardio: HealthStatusIndicator[]; lifestyle: HealthStatusIndicator[] } {
  const cardio: HealthStatusIndicator[] = [];
  const lifestyle: HealthStatusIndicator[] = [];

  const bp = firstTwo(vitals.blood_pressure);
  const target = isObj(vitals.bp_target) ? vitals.bp_target : null;
  const tSys = target ? num(target.systolic) : null, tDia = target ? num(target.diastolic) : null;
  if (bp[0]) {
    const sys = num(bp[0].systolic), dia = num(bp[0].diastolic), at = str(bp[0].taken_at);
    if (sys !== null && dia !== null && at) {
      const prevSys = bp[1] ? num(bp[1].systolic) : null, prevDia = bp[1] ? num(bp[1].diastolic) : null;
      cardio.push({
        key: "blood_pressure",
        label: "Blood pressure",
        value: `${sys}/${dia}`,
        unit: "mmHg",
        at,
        rangeText: tSys !== null && tDia !== null ? `your target is below ${tSys}/${tDia} mmHg` : null,
        flag: tSys === null || tDia === null ? "no_range" : sys >= tSys || dia >= tDia ? "above" : "in_range",
        trend: trendOf(sys, prevSys),
        previousValue: prevSys !== null && prevDia !== null ? `${prevSys}/${prevDia}` : null,
        previousAt: bp[1] ? str(bp[1].taken_at) : null,
      });
    }
  }

  const weight = firstTwo(vitals.weight);
  const height = num(vitals.height_cm);
  if (weight[0]) {
    const kg = num(weight[0].kg), at = str(weight[0].taken_at);
    if (kg !== null && at) {
      const prev = weight[1] ? num(weight[1].kg) : null;
      lifestyle.push({
        key: "weight", label: "Weight", value: displayNumber(kg), unit: "kg", at, rangeText: null, flag: "no_range",
        trend: trendOf(kg, prev), previousValue: prev === null ? null : displayNumber(prev), previousAt: weight[1] ? str(weight[1].taken_at) : null,
      });
      if (height !== null && height > 0) {
        const bmi = kg / (height / 100) ** 2;
        const prevBmi = prev === null ? null : prev / (height / 100) ** 2;
        const overweight = getProposedConfig<{ bmiOverweight: number }>("pathways.weight").value.bmiOverweight;
        lifestyle.push({
          key: "bmi", label: "Body mass index", value: displayNumber(Math.round(bmi * 10) / 10), unit: null, at,
          rangeText: `below ${overweight} is the usual adult range`, flag: bmi >= overweight ? "above" : "in_range",
          trend: trendOf(Math.round(bmi * 10) / 10, prevBmi === null ? null : Math.round(prevBmi * 10) / 10),
          previousValue: prevBmi === null ? null : displayNumber(Math.round(prevBmi * 10) / 10), previousAt: weight[1] ? str(weight[1].taken_at) : null,
        });
      }
    }
  }

  const waist = firstTwo(vitals.waist);
  if (waist[0]) {
    const cm = num(waist[0].cm), at = str(waist[0].taken_at);
    if (cm !== null && at) {
      const prev = waist[1] ? num(waist[1].cm) : null;
      lifestyle.push({
        key: "waist", label: "Waist", value: displayNumber(cm), unit: "cm", at, rangeText: null, flag: "no_range",
        trend: trendOf(cm, prev), previousValue: prev === null ? null : displayNumber(prev), previousAt: waist[1] ? str(waist[1].taken_at) : null,
      });
    }
  }
  return { cardio, lifestyle };
}

function screeningDomain(screening: Record<string, unknown>, now: Date): HealthStatusDomain | null {
  const open = Array.isArray(screening.open) ? screening.open.filter(isObj) : [];
  const completed = num(screening.completed_last_year) ?? 0;
  if (open.length === 0 && completed === 0) return null;
  const actions: string[] = [];
  let overdue = 0;
  for (const s of open) {
    const name = str(s.name);
    if (!name) continue;
    const due = str(s.due_date);
    const isOverdue = s.status === "overdue" || (due !== null && new Date(`${due}T23:59:59+01:00`) < now && s.status !== "booked");
    if (isOverdue) overdue += 1;
    if (s.status === "booked") actions.push(`${name}: booked`);
    else actions.push(`${name}: ${isOverdue ? "now due" : due ? `due ${due}` : "due"}`);
  }
  return {
    key: "screening",
    ...DOMAIN_META.screening,
    status: overdue > 0 ? "worth_discussing" : "within_range",
    indicators: [],
    actions: [
      ...(completed > 0 ? [`${completed} ${completed === 1 ? "check" : "checks"} done in the last 12 months`] : []),
      ...actions,
    ],
  };
}

const ACTION_DISCUSS = "Talk this through with your care team at your next check-in.";
const ACTION_KEEP_LOGGING_BP = "Keep logging your blood pressure. Your care team sees every reading.";

function statusOf(indicators: HealthStatusIndicator[]): HealthStatusDomain["status"] {
  if (indicators.some((i) => i.flag === "above" || i.flag === "below")) return "worth_discussing";
  if (indicators.some((i) => i.flag === "in_range")) return "within_range";
  return "not_enough_yet";
}

/** Pure: the domains to show, in a fixed order, leaving out any domain with nothing behind it. */
export function buildHealthStatusDomains(input: HealthStatusInput, now: Date = new Date()): HealthStatusDomain[] {
  const byDomain = new Map<HealthStatusDomainKey, HealthStatusIndicator[]>(HEALTH_STATUS_DOMAIN_ORDER.map((k) => [k, []]));
  if (Array.isArray(input.labs)) {
    for (const row of input.labs) {
      if (!isObj(row)) continue;
      const hit = labIndicator(row);
      if (hit) byDomain.get(hit.domain)!.push(hit.indicator);
    }
  }
  if (isObj(input.vitals)) {
    const v = vitalsIndicators(input.vitals);
    byDomain.get("cardiometabolic")!.unshift(...v.cardio);
    byDomain.get("lifestyle")!.push(...v.lifestyle);
  }

  const out: HealthStatusDomain[] = [];
  for (const key of HEALTH_STATUS_DOMAIN_ORDER) {
    if (key === "screening") {
      const s = isObj(input.screening) ? screeningDomain(input.screening, now) : null;
      if (s) out.push(s);
      continue;
    }
    const indicators = byDomain.get(key)!;
    if (indicators.length === 0) continue;
    const status = statusOf(indicators);
    const actions: string[] = [];
    if (status === "worth_discussing") actions.push(ACTION_DISCUSS);
    if (indicators.some((i) => i.key === "blood_pressure" && i.flag === "above")) actions.push(ACTION_KEEP_LOGGING_BP);
    out.push({ key, ...DOMAIN_META[key], status, indicators, actions });
  }
  return out;
}

export const HEALTH_STATUS_WORDS: Record<HealthStatusDomain["status"], string> = {
  within_range: "Within range",
  worth_discussing: "Worth discussing",
  not_enough_yet: "No range to compare yet",
};

export const INDICATOR_FLAG_WORDS: Record<IndicatorFlag, string> = {
  in_range: "within range",
  above: "above range",
  below: "below range",
  no_range: "no range printed",
};

/** "Up from 6.7 on 2026-08-04", "Same as last time", or null for a first result. Plain, never a judgement. */
export function trendWords(i: HealthStatusIndicator, formatDate: (iso: string) => string = (iso) => iso.slice(0, 10)): string | null {
  if (i.trend === "first" || i.previousValue === null) return null;
  if (i.trend === "same") return "Same as last time";
  const when = i.previousAt ? ` on ${formatDate(i.previousAt)}` : "";
  return `${i.trend === "up" ? "Up" : "Down"} from ${i.previousValue}${when}`;
}

/** A one-line summary with no score: how many areas are shown and how many are worth discussing. */
export function healthStatusSummary(domains: HealthStatusDomain[]): string | null {
  if (domains.length === 0) return null;
  const discuss = domains.filter((d) => d.status === "worth_discussing").length;
  const areas = `${domains.length} ${domains.length === 1 ? "area" : "areas"} of your health tracked`;
  return discuss === 0 ? `${areas}. Nothing outside its range right now.` : `${areas}. ${discuss} worth discussing with your care team.`;
}

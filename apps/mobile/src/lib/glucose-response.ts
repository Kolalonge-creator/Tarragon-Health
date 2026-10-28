import { supabase } from "./supabase";
import { getGlucoseDisplayUnit } from "./glucose-unit";
import { getProposedConfig, formatGlucose, GLUCOSE_UNIT_LABEL } from "@tarragon/shared";
import {
  mealsFromFoodLogs,
  parseGlucoseSeries,
  responseRows,
  summariseGlucoseResponse,
  type GlucoseResponseConfig,
  type GlucoseResponseSummary,
  type ResponseRow,
} from "@tarragon/clinical/glucose-response";

const config = getProposedConfig("glucose_response.rules").value as unknown as GlucoseResponseConfig;

export const GLUCOSE_RESPONSE_MIN_PAIRS = config.min_pairs_to_show;

export type GlucoseResponseResult = { state: "unavailable" } | { state: "ok"; summary: GlucoseResponseSummary; rows: readonly ResponseRow[] };

/**
 * Personal glucose-response insights on the phone (S50b, 6.11): the same shared pure rules as the web card. Ranges and sample counts only.
 * public.my_glucose_series() applies the go-live guard and the withheld rule (pregnancy, under 18, eating-disorder screen, clinician hold); an error or a
 * reading it cannot parse is "unavailable" and the card shows nothing.
 */
export async function loadGlucoseResponse(now: Date = new Date()): Promise<GlucoseResponseResult> {
  const since = new Date(now.getTime() - config.max_age_days * 86_400_000).toISOString();
  const [series, meals] = await Promise.all([
    supabase.rpc("my_glucose_series", { p_days: config.max_age_days }),
    supabase.from("food_logs").select("id, logged_at, items").gte("logged_at", since).order("logged_at", { ascending: false }).limit(500),
  ]);
  if (series.error || meals.error) return { state: "unavailable" };
  const parsed = parseGlucoseSeries(series.data);
  if (parsed.state === "unavailable") return { state: "unavailable" };
  const logs = (meals.data ?? []).flatMap((m) => (m.id && m.logged_at ? [{ id: m.id, logged_at: m.logged_at, items: m.items }] : []));
  const summary = summariseGlucoseResponse(mealsFromFoodLogs(logs), parsed.points, config, now.toISOString());
  const unit = await getGlucoseDisplayUnit();
  const fmt = (mmol: number): string => formatGlucose(mmol, unit, { withUnit: false }) ?? "";
  return { state: "ok", summary, rows: responseRows(summary, fmt, GLUCOSE_UNIT_LABEL[unit]) };
}

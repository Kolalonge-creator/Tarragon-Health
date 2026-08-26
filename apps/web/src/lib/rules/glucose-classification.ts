import { classifyGlucose } from "@/lib/vitals/glucose-red-flags";
import type { BpLevel } from "./bp-classification";

/** Same green/amber/red/emergency/unknown scale as bp-classification.ts,
 * spo2-classification.ts, temperature-classification.ts. */
export type GlucoseLevel = BpLevel;

/**
 * Single-reading-only mirror of the authoritative multi-reading glucose
 * engine (lib/vitals/glucose-red-flags.ts / assess-glucose.ts), for
 * presentation only (a tile color) — the same "non-clinical presentation
 * copy of the real engine" pattern bp/spo2/temperature-classification.ts
 * already use, just built by calling the real engine with a window of one
 * rather than re-deriving its thresholds by hand.
 *
 * Deliberately narrower than the real engine: the pattern tiers (persistent
 * hyperglycaemia, recurrent hypo) need a trailing window of readings, and the
 * DKA / moderate-ketone tiers need a ketone reading — this only ever sees one
 * glucose value, so those stay unreachable here and remain exclusively the
 * real engine's job. What this DOES catch — severe hypo, a same-day hypo
 * alert, and a very-high acute value — are exactly the single-reading bands,
 * so a genuinely dangerous glucose reading still gets a red/emergency tile
 * even on a plan where vitals_red_flag_doctor_escalation gates the real
 * engine from writing a clinician_alerts row (see
 * 20260810120000_gate_vitals_red_flag_escalation_to_paid_plans.sql) — the
 * one case an alert-only status check would otherwise silently show Normal.
 */
export function classifyLatestGlucoseLevel(glucoseMmolL: number | null | undefined): GlucoseLevel {
  if (glucoseMmolL == null) return "unknown";
  const flag = classifyGlucose({
    latestGlucose: glucoseMmolL,
    latestKetoneMmol: null,
    latestKetoneUrine: null,
    recentGlucose: [glucoseMmolL],
  });
  switch (flag.tier) {
    case "emergency":
      return "emergency";
    case "urgent":
      return "red";
    case "amber":
      return "amber";
    default:
      return "green";
  }
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { RuleWindowSpec } from "./types";

/** Column each vital_type's threshold check reads, mirroring vitals_readings' shape. */
const VITAL_FIELD_BY_TYPE: Record<string, string> = {
  blood_pressure: "systolic",
  glucose: "glucose_mmol_l",
  weight: "weight_kg",
  pulse: "pulse_bpm",
  temperature: "temperature_c",
  spo2: "spo2_pct",
  waist_circumference: "waist_cm",
  ketones: "ketones_mmol_l",
  respiratory_rate: "respiratory_rate_bpm",
  peak_flow: "peak_flow_l_min",
};

/**
 * §32.4's worked example, made real: "repeated readings exceed configured
 * threshold" over the trailing `days` window. Runs ONE aggregate query
 * (count matching the comparator) rather than pulling raw rows into JS, so
 * this stays cheap even for a patient with years of vitals history.
 *
 * Returns the match count, or null when the window spec names a metric this
 * evaluator does not (yet) support — a rule referencing an unsupported
 * metric should be caught at authoring/simulation time (§32.12), never
 * silently treated as "0 matches, condition never met".
 */
export async function evaluateWindow(
  supabase: SupabaseClient<Database>,
  patientId: string,
  window: RuleWindowSpec
): Promise<number | null> {
  const since = new Date(Date.now() - window.days * 24 * 60 * 60 * 1000).toISOString();

  switch (window.metric) {
    case "vital_reading": {
      const field = window.field ?? (window.vital_type ? VITAL_FIELD_BY_TYPE[window.vital_type] : undefined);
      if (!window.vital_type || !field) return null;

      const base = supabase
        .from("vitals_readings")
        .select("id", { count: "exact", head: true })
        .eq("patient_id", patientId)
        .eq("vital_type", window.vital_type)
        .gte("taken_at", since);

      const filtered =
        window.comparator === "gte"
          ? base.gte(field, window.threshold)
          : window.comparator === "lte"
            ? base.lte(field, window.threshold)
            : window.comparator === "gt"
              ? base.gt(field, window.threshold)
              : window.comparator === "lt"
                ? base.lt(field, window.threshold)
                : base.eq(field, window.threshold);

      const { count, error } = await filtered;
      if (error) throw error;
      return count ?? 0;
    }

    case "screening_result": {
      const { count, error } = await supabase
        .from("screening_results")
        .select("id", { count: "exact", head: true })
        .eq("patient_id", patientId)
        .in("result_status", window.threshold >= 1 ? ["abnormal", "critical"] : ["normal"])
        .gte("created_at", since);
      if (error) throw error;
      return count ?? 0;
    }

    case "appointment_missed": {
      const { count, error } = await supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("patient_id", patientId)
        .eq("status", "no_show")
        .gte("scheduled_for", since);
      if (error) throw error;
      return count ?? 0;
    }

    case "medication_dose_missed":
      // No dedicated missed-dose table exists yet on this platform (dose
      // tracking is client-side adherence logging) — deliberately
      // unsupported rather than guessed at.
      return null;

    default:
      return null;
  }
}

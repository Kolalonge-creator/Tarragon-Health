import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export interface GrowthMeasurementRow {
  id: string;
  measured_at: string;
  age_days_at_measurement: number;
  height_cm: number | null;
  weight_kg: number | null;
  head_circumference_cm: number | null;
  bmi: number | null;
  weight_for_age_z: number | null;
  height_for_age_z: number | null;
  bmi_for_age_z: number | null;
  weight_for_height_z: number | null;
  muac_mm: number | null;
  muac_for_age_z: number | null;
  reference_version: string | null;
  plausibility_flags: string[];
  nutrition_class: "severe_acute" | "moderate_acute" | "none" | null;
}

export function growthMeasurementsKey(patientId: string) {
  return ["growth-measurements", patientId] as const;
}

export function useGrowthMeasurements(patientId: string) {
  return useQuery({
    queryKey: growthMeasurementsKey(patientId),
    queryFn: async (): Promise<GrowthMeasurementRow[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("child_growth_measurements")
        .select(
          "id, measured_at, age_days_at_measurement, height_cm, weight_kg, head_circumference_cm, bmi, weight_for_age_z, height_for_age_z, bmi_for_age_z, weight_for_height_z, muac_mm, muac_for_age_z, reference_version, plausibility_flags, nutrition_class"
        )
        .eq("patient_id", patientId)
        .order("measured_at", { ascending: true });
      if (error) throw error;
      return data.map((r) => ({ ...r, nutrition_class: asNutritionClass(r.nutrition_class) }));
    },
    enabled: !!patientId,
  });
}

function asNutritionClass(v: string | null): GrowthMeasurementRow["nutrition_class"] {
  return v === "severe_acute" || v === "moderate_acute" || v === "none" ? v : null;
}

export interface LogGrowthMeasurementInput {
  patientId: string;
  organisationId: string;
  measuredAt?: string;
  heightCm?: number | null;
  weightKg?: number | null;
  headCircumferenceCm?: number | null;
  muacMm?: number | null;
  measurePosition?: "recumbent" | "standing" | null;
  bilateralOedema?: boolean;
  note?: string | null;
}

/** Every other field (age_days_at_measurement, bmi, the z-scores, reference_version, plausibility flags, source, recorded_by, the
 * nutrition class) is computed or stamped server-side by private.stamp_growth_measurement and private.route_child_nutrition
 * (S68d). This mutation only ever sends the raw measurement and how it was taken. */
export function useLogGrowthMeasurement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: LogGrowthMeasurementInput) => {
      const supabase = createClient();
      const { error } = await supabase.from("child_growth_measurements").insert({
        patient_id: input.patientId,
        organisation_id: input.organisationId,
        measured_at: input.measuredAt ?? new Date().toISOString(),
        height_cm: input.heightCm ?? null,
        weight_kg: input.weightKg ?? null,
        head_circumference_cm: input.headCircumferenceCm ?? null,
        muac_mm: input.muacMm ?? null,
        measure_position: input.measurePosition ?? null,
        bilateral_oedema: input.bilateralOedema ?? false,
        note: input.note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: growthMeasurementsKey(variables.patientId) });
    },
  });
}

/** The courtesy check for the maternal_enabled go-live guard (INV-14, client side). Fails closed: an error reads as "not open". */
export function useMaternalFollowUpOpen() {
  return useQuery({
    queryKey: ["go-live-guard", "maternal_enabled"] as const,
    queryFn: async (): Promise<boolean> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("go_live_guard_is_open", { p_key: "maternal_enabled" });
      if (error) return false;
      return data === true;
    },
  });
}

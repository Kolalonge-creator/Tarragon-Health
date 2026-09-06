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
          "id, measured_at, age_days_at_measurement, height_cm, weight_kg, head_circumference_cm, bmi, weight_for_age_z, height_for_age_z, bmi_for_age_z"
        )
        .eq("patient_id", patientId)
        .order("measured_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

export interface LogGrowthMeasurementInput {
  patientId: string;
  organisationId: string;
  measuredAt?: string;
  heightCm?: number | null;
  weightKg?: number | null;
  headCircumferenceCm?: number | null;
  note?: string | null;
}

/** Every other field (age_days_at_measurement, bmi, the four z-scores,
 * logged_by_profile_id) is computed/stamped server-side by
 * private.stamp_growth_measurement — see
 * 20260829121652_pediatric_growth_monitoring.sql. This mutation only ever
 * sends the raw measurement. */
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
        note: input.note ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: growthMeasurementsKey(variables.patientId) });
    },
  });
}

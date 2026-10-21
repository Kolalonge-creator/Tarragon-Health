import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { parseActivityGate, unavailableActivityGate, type ActivityGateResult, type ActivitySafetyConfig } from "@tarragon/clinical/activity-gate";

/**
 * The activity safety gate (S48a). The database function public.activity_gate() is the one enforcing answer; this only reads and shows it.
 * If the question cannot be asked (offline, an error), the answer is the fail-closed one (gentle only), never a permissive guess, and the
 * caller is told it was unavailable so it can say so rather than pretend.
 */
export type ActivityGateAnswer = { gate: ActivityGateResult; unavailable: boolean };

export async function fetchActivityGate(): Promise<ActivityGateAnswer> {
  const { data, error } = await createClient().rpc("activity_gate");
  if (error) return { gate: unavailableActivityGate(), unavailable: true };
  return { gate: parseActivityGate(data), unavailable: false };
}

export function useActivityGate() {
  return useQuery({ queryKey: ["activity-gate"], queryFn: fetchActivityGate });
}

export type WorkoutPlan = {
  code: string;
  title: string;
  level: "gentle" | "moderate" | "vigorous";
  format: "home" | "chair_class";
  conditions_safe_for: string[];
  sessions: { minutes: number; steps: string[] }[];
  audio_clip_ids: string[];
};

/** Reviewed workout plans the gate allows for this person. Empty until a clinician has reviewed a plan. */
export function useWorkoutPlans() {
  return useQuery({
    queryKey: ["my-workout-plans"],
    queryFn: async (): Promise<WorkoutPlan[]> => {
      const { data, error } = await createClient().rpc("my_workout_plans");
      if (error || !Array.isArray(data)) return [];
      return data as unknown as WorkoutPlan[];
    },
  });
}

export type WeekProgress = {
  week_start: string;
  steps: number;
  active_minutes: number;
  days_step_goal_met: number;
  daily_steps_goal: number;
  weekly_active_minutes_goal: number;
};

export function useWeekProgress(patientId: string) {
  return useQuery({
    queryKey: ["activity-week-progress", patientId],
    queryFn: async (): Promise<WeekProgress | null> => {
      const { data, error } = await createClient().rpc("activity_week_progress");
      if (error || data === null || typeof data !== "object" || Array.isArray(data)) return null;
      return data as unknown as WeekProgress;
    },
    enabled: !!patientId,
  });
}

/** The active safety config (readable by any signed-in person), used only to LABEL kinds in the picker; the gate itself is the database's. Null when unreadable. */
export function useActivitySafetyConfig() {
  return useQuery({
    queryKey: ["activity-safety-config"],
    queryFn: async (): Promise<ActivitySafetyConfig | null> => {
      const { data, error } = await createClient().from("activity_safety_config").select("config").eq("is_active", true).maybeSingle();
      if (error || !data) return null;
      const safety = (data.config as { safety?: unknown } | null)?.safety;
      return safety && typeof safety === "object" ? (safety as ActivitySafetyConfig) : null;
    },
  });
}

"use client";

import {
  useRoutineProfile,
  useSetRoutinePreference,
  type RoutinePreference,
} from "@/lib/queries/routine-profile";
import { Button } from "@/components/ui/button";

const OPTIONS: { value: RoutinePreference; label: string }[] = [
  { value: "morning", label: "Mornings" },
  { value: "evening", label: "Evenings" },
  { value: "varies", label: "It varies" },
];

const ROUTINE_LABEL: Record<RoutinePreference, string> = {
  morning: "a morning routine",
  evening: "an evening routine",
  varies: "a routine that varies day to day",
};

/**
 * A one-time, plain-form question — not routed through the AI coach chat's
 * LangGraph turn (lib/ai-coach/graph.ts). That graph is a safety-critical
 * state machine (deterministic emergency-keyword guardrail -> structured
 * Claude tiering -> escalation logging); a form field is a lower-risk way
 * to capture the same "what does your routine look like" input the coach
 * would otherwise have to ask conversationally, with zero change to that
 * graph. Answering is honest about what it does: the plan doesn't have
 * per-task time-of-day data to actually re-sort by yet, so this only
 * acknowledges the stated routine rather than claiming to reschedule tasks
 * around it.
 */
export function RoutineProfilePrompt({ patientId }: { patientId: string }) {
  const { data: profile, isLoading } = useRoutineProfile(patientId);
  const setRoutine = useSetRoutinePreference(patientId);

  if (isLoading || !profile) return null;

  if (profile.routine) {
    return (
      <p className="mt-4 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-3 text-xs text-charcoal-ink/50 dark:text-night-ink/55">
        Your care team knows you keep {ROUTINE_LABEL[profile.routine]}.
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-2 border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-3">
      <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
        Quick one: is your day usually more of a morning person or an evening person?
      </p>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant="outline"
            disabled={setRoutine.isPending}
            onClick={() =>
              setRoutine.mutate({ enrollmentId: profile.enrollmentId, routine: option.value })
            }
          >
            {option.label}
          </Button>
        ))}
      </div>
      {setRoutine.isError && (
        <p className="text-xs text-red-600 dark:text-red-300">Could not save that just now. Please try again.</p>
      )}
    </div>
  );
}

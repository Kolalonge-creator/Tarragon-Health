import { describeCoachSource, type CoachSource } from "@tarragon/shared";

/**
 * S51 (7.2, 7.9): the sources behind an assistant reply, shown to the patient under it. Built from rows the code read (reviewed content
 * with its owner and review date, the patient's own record), never from text the model wrote. Renders nothing when there are none.
 */
export function CoachSources({ sources }: { sources: CoachSource[] }) {
  if (sources.length === 0) return null;
  return (
    <p className="text-[11px] text-charcoal-ink/60 dark:text-night-ink/60" data-testid="coach-sources">
      Sources: {sources.map((s) => describeCoachSource(s)).join("; ")}
    </p>
  );
}

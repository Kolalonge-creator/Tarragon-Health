import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadFailure } from "@/components/ui/load-failure";
import { LEVEL_BADGE } from "@/lib/worklist/level-badge";
import type { NextActionView } from "@tarragon/shared";

const COUNTDOWN_TONE = {
  overdue: "text-red-700 dark:text-red-300",
  due_soon: "text-amber-700 dark:text-amber-300",
  on_track: "text-charcoal-ink/70 dark:text-night-ink/70",
  no_due_time: "text-charcoal-ink/60 dark:text-night-ink/60",
} as const;

/**
 * The one card at the top of the clinician home: the case to do next, how long
 * it has, and one button. The ranking is rankEscalations (severity, then
 * nearest due time) in @tarragon/shared; this only draws the result.
 *
 * Three states, and a failed read is never drawn as the all-clear one.
 */
export function NextActionHero({ view }: { view: NextActionView }) {
  if (view.kind === "unknown") {
    return (
      <LoadFailure>
        Your next case could not be loaded. Do not read this as &ldquo;nothing waiting&rdquo;: open
        the escalations worklist directly to check.
        <Link href="/clinician/escalations" className="ml-1 font-medium underline">
          Open escalations
        </Link>
      </LoadFailure>
    );
  }

  if (view.kind === "clear") {
    return (
      <section
        aria-label="Your next case"
        className="rounded-2xl bg-white p-5 dark:bg-night-card sm:p-6"
      >
        <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">
          Your next case
        </p>
        <p className="mt-2 font-heading text-xl font-semibold text-charcoal-ink dark:text-night-ink">
          No open escalations
        </p>
        <p className="mt-1 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          Nothing is waiting on a doctor right now. Your notes and reviews are below.
        </p>
      </section>
    );
  }

  const { escalation, countdown, behind } = view.action;
  const levelBadge = escalation.level ? LEVEL_BADGE[escalation.level] : null;

  return (
    <section
      aria-label="Your next case"
      className="space-y-3 rounded-2xl bg-white p-5 dark:bg-night-card sm:p-6"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/60 dark:text-night-ink/60">
        Your next case
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {levelBadge && <Badge variant={levelBadge.variant}>{levelBadge.label}</Badge>}
        <span className={`text-sm font-medium ${COUNTDOWN_TONE[countdown.state]}`}>
          {countdown.label}
        </span>
      </div>
      <div>
        <p className="font-heading text-2xl font-semibold text-charcoal-ink dark:text-night-ink">
          {escalation.patientName ?? "Unknown patient"}
        </p>
        <p className="mt-1 max-w-xl text-sm text-charcoal-ink/80 dark:text-night-ink/80">
          {escalation.reason}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button asChild size="lg">
          <Link href={`/clinician/escalations/${escalation.id}`}>Open this case</Link>
        </Button>
        {behind > 0 && (
          <Link
            href="/clinician/escalations"
            className="inline-flex min-h-11 items-center text-sm font-medium text-brand-green hover:underline dark:text-brand-green-bright"
          >
            {behind === 1 ? "1 more case waiting" : `${behind} more cases waiting`} →
          </Link>
        )}
      </div>
    </section>
  );
}

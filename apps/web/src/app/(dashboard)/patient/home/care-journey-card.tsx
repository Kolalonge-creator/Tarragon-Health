import Link from "next/link";
import { STATUS_CLASSES } from "@tarragon/ui/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JOURNEY_STATE_LABEL, type JourneyStage, type JourneyState } from "@/lib/patient/care-journey";
import { cn } from "@/lib/utils";

/** Status chip colour per state, from the clinical status tokens. The chip always carries words. */
const CHIP: Record<JourneyState, string> = {
  done: STATUS_CLASSES.normal.tint + " " + STATUS_CLASSES.normal.text,
  on_you: STATUS_CLASSES.attention.tint + " " + STATUS_CLASSES.attention.text,
  care_team: STATUS_CLASSES.info.tint + " " + STATUS_CLASSES.info.text,
  in_progress: STATUS_CLASSES.info.tint + " " + STATUS_CLASSES.info.text,
  not_started: STATUS_CLASSES.inactive.tint + " " + STATUS_CLASSES.inactive.text,
  membership: STATUS_CLASSES.inactive.tint + " " + STATUS_CLASSES.inactive.text,
  unknown: STATUS_CLASSES.inactive.tint + " " + STATUS_CLASSES.inactive.text,
};

/**
 * "Your care journey" (spec 4.4; PD-03). Where each part of Tarragon's care stands for this patient, from real records. Stages can
 * be done in any order, so this is a list, not a stepper.
 */
export function CareJourneyCard({ stages }: { stages: JourneyStage[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your care journey</CardTitle>
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          How each part of your care stands. You can do these in any order.
        </p>
      </CardHeader>
      <CardContent>
        <ol className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15" data-testid="care-journey">
          {stages.map((stage) => (
            <li key={stage.id}>
              <Link
                href={stage.href}
                className="flex min-h-11 items-start justify-between gap-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-charcoal-ink dark:text-night-ink">{stage.title}</span>
                  <span className="block text-sm text-charcoal-ink/70 dark:text-night-ink/70">{stage.detail}</span>
                </span>
                <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium", CHIP[stage.state])}>
                  {JOURNEY_STATE_LABEL[stage.state]}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

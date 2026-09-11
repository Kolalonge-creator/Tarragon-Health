import Link from "next/link";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * What a brand-new patient sees instead of a page of empty cards.
 *
 * Before this, day one on the Overview was: four stat tiles all reading "No
 * reading yet", a health score with nothing to score, a trend chart saying
 * "Not enough readings yet", an empty timeline, an empty schedule -- and,
 * last on the page, a prompt to pay for something. Every one of those cards
 * is right for a patient with a history and useless for a patient without
 * one, and the app never once said what it was for or what to do first.
 *
 * Three steps, in the order that actually unlocks the product: the health
 * profile builds the screening calendar everything preventive hangs off,
 * a first reading is what the care team can act on, and the medicines list
 * is what makes reminders and refills work. Completed steps stay visible
 * with a tick rather than disappearing -- three items where one is done
 * reads as progress; two items with no explanation of the missing third
 * reads as a shorter list.
 *
 * The card removes itself once all three are done (see shouldShowGetStarted).
 */
export interface GetStartedProgress {
  hasRiskAssessment: boolean;
  hasAnyVitals: boolean;
  hasMedications: boolean;
}

/**
 * Whether the Overview should lead with this card rather than its usual
 * analytic stack. Deliberately "any step outstanding", not "nothing at all
 * done": somebody who logged a reading but never filled in a health profile
 * still has no screening calendar, and the old dashboard gave them no route
 * to one.
 */
export function shouldShowGetStarted(p: GetStartedProgress): boolean {
  return !(p.hasRiskAssessment && p.hasAnyVitals && p.hasMedications);
}

/**
 * The narrower question: is this a genuinely empty account? Used to suppress
 * the cards that can only say "not enough data yet" -- a distinct question
 * from whether to show the card above, because a patient part-way through
 * setup does have real data worth charting.
 */
export function isFirstRun(p: GetStartedProgress): boolean {
  return !p.hasRiskAssessment && !p.hasAnyVitals && !p.hasMedications;
}

interface Step {
  title: string;
  detail: string;
  href: string;
  cta: string;
  done: boolean;
}

export function GetStartedCard({
  progress,
  acting,
}: {
  progress: GetStartedProgress;
  /** Name of the person whose account this is, when a supporter is running
   * it, so the steps do not tell a supporter to log "your" readings. */
  acting?: string | null;
}) {
  const subject = acting ? `${acting}'s` : "your";
  const them = acting ? "them" : "you";

  const steps: Step[] = [
    {
      title: "Fill in the health profile",
      detail: `About two minutes. It builds ${subject} personal screening and vaccination calendar: the checks that keep well people well.`,
      href: "/patient/prevention",
      cta: "Start the profile",
      done: progress.hasRiskAssessment,
    },
    {
      title: "Log the first reading",
      detail:
        "Blood pressure, blood sugar or weight, from any meter, typed in by hand. This is what the care team looks at.",
      href: "/patient/vitals",
      cta: "Log a reading",
      done: progress.hasAnyVitals,
    },
    {
      title: "Add the medicines",
      detail: `Whatever ${them} take now. Once they are on the list, ${them} get dose reminders and refill nudges.`,
      href: "/patient/medications",
      cta: "Add a medicine",
      done: progress.hasMedications,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section
      aria-labelledby="get-started-heading"
      className="rounded-2xl border border-brand-green/25 bg-soft-sage/30 p-5 dark:border-brand-green-bright/25 dark:bg-brand-green/10"
    >
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="get-started-heading"
          className="font-heading text-lg font-semibold text-charcoal-ink dark:text-night-ink"
        >
          Three things to set up
        </h2>
        <p className="text-xs font-medium text-charcoal-ink/55 dark:text-night-ink/60">
          {doneCount} of {steps.length} done
        </p>
      </div>
      <p className="mb-4 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
        This app keeps {subject} health record in one place, tells {them} which checks are due, and
        puts {acting ? "their" : "your"} readings in front of a care team who can act on them. These
        three steps are what switch that on.
      </p>

      <ol className="space-y-2.5">
        {steps.map((step, index) => (
          <li
            key={step.href}
            className={cn(
              "flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center",
              step.done
                ? "border-brand-green/20 bg-white/50 dark:border-brand-green-bright/20 dark:bg-night-card/40"
                : "border-charcoal-ink/10 bg-white dark:border-night-ink/15 dark:bg-night-card"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                step.done
                  ? "bg-brand-green text-white"
                  : "bg-charcoal-ink/[0.07] text-charcoal-ink/70 dark:bg-night-ink/10 dark:text-night-ink/70"
              )}
            >
              {step.done ? "✓" : index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block text-sm font-semibold",
                  step.done
                    ? "text-charcoal-ink/55 line-through decoration-charcoal-ink/25 dark:text-night-ink/55"
                    : "text-charcoal-ink dark:text-night-ink"
                )}
              >
                {step.title}
                <span className="sr-only">{step.done ? " (done)" : ""}</span>
              </span>
              {!step.done && (
                <span className="mt-0.5 block text-xs text-charcoal-ink/65 dark:text-night-ink/65">
                  {step.detail}
                </span>
              )}
            </span>
            {!step.done && (
              <Link
                href={step.href}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-brand-green px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-deep-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2"
              >
                {step.cta}
                <NAV_ICON.chevronRight aria-hidden className="h-4 w-4" strokeWidth={2.5} />
              </Link>
            )}
          </li>
        ))}
      </ol>

      <p className="mt-4 text-xs text-charcoal-ink/55 dark:text-night-ink/60">
        <SEMANTIC_ICON.preventive aria-hidden className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
        All of this is free. You are only ever charged for a doctor&apos;s time, and only when you
        ask for it.
      </p>
    </section>
  );
}

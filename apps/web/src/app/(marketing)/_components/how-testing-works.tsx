import Link from "next/link";
import { cn } from "@/lib/utils";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";

/**
 * A single, canonical explanation of the three distinct testing "lenses" on
 * the platform, rendered on all four pages that touch any of them
 * (annual-health-check, screening-journey, diabetes, hypertension) so the
 * distinction is defined once and stays consistent, rather than drifting
 * across four independently-worded explanations. Deliberately not a fourth
 * new page or nav item: these three already exist as real, separate
 * mechanisms (a one-off purchasable bundle; an age/sex-driven due-date
 * engine in screening-recommendations.ts; and care-plan-driven monitoring
 * keyed off drug_monitoring_rules / vitals_reminder_rules / the
 * diabetes complication trackers) — this component just names that
 * structure plainly so a reader isn't left to infer it from three
 * separately-styled pages.
 */
type Lens = "annual" | "periodic" | "chronic";

const LENSES: { id: Lens; title: string; body: string; href: string; linkLabel: string }[] = [
  {
    id: "annual",
    title: "Your Annual Health Check",
    body: "One bundled laboratory visit each year, covering core blood tests, baseline checks of your organs, and screening for infectious disease in a single trip.",
    href: MARKETING_ROUTES.annualHealthCheck,
    linkLabel: "See what is in the bundle",
  },
  {
    id: "periodic",
    title: "Your Screening Journey",
    body: "A fuller, personal calendar of every screening recommended for your age and sex. Each test follows its own recommended interval, some every year and some every two or three years, whether or not it is part of a bundle.",
    href: MARKETING_ROUTES.screeningJourney,
    linkLabel: "See your screening calendar",
  },
  {
    id: "chronic",
    title: "Chronic Condition Monitoring",
    body: "If you are diagnosed with a condition such as hypertension or diabetes, you follow a separate and much more frequent set of checks, some daily and some every few months, for as long as you are on that care plan.",
    href: MARKETING_ROUTES.hypertension,
    linkLabel: "See hypertension and diabetes monitoring",
  },
];

export function HowTestingWorks({ current }: { current: Lens }) {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8 text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-deep-forest">
          How the pieces fit together
        </p>
        <h2 className="mt-2 font-heading text-2xl font-semibold text-charcoal-ink sm:text-3xl">
          Three different kinds of testing
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-charcoal-ink/70">
          These run alongside each other and do not replace one another. Which ones apply to you
          depends on your age, your sex and whether you have a diagnosed condition. You do not
          have to choose between them.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {LENSES.map((lens) => {
          const isCurrent = lens.id === current;
          return (
            <div
              key={lens.id}
              className={cn(
                "rounded-xl border p-5",
                isCurrent
                  ? "border-2 border-brand-green bg-brand-green/5"
                  : "border-charcoal-ink/10 bg-white"
              )}
            >
              {isCurrent ? (
                <span className="mb-2 inline-block rounded-full bg-brand-green px-2.5 py-0.5 text-[11px] font-medium text-white">
                  You are here
                </span>
              ) : null}
              <h3 className="font-heading text-base font-semibold text-charcoal-ink">
                {lens.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/70">{lens.body}</p>
              {isCurrent ? null : (
                <Link
                  href={lens.href}
                  className="mt-3 inline-block text-sm font-medium text-brand-green hover:underline"
                >
                  {lens.linkLabel} <span aria-hidden>→</span>
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

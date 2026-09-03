import Link from "next/link";
import { type AppIconName, APP_ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * The everyday jobs, as buttons, directly under the Overview hero.
 *
 * Before this existed, each of these took a patient two moves — find the
 * right section in the sidebar, then find the right card inside it — for
 * things they do several times a week. The Overview was a wall of read-only
 * cards you scrolled through; there was nowhere on it to actually *do*
 * anything. Every destination here already existed and is unchanged; this is
 * wayfinding, not a new feature, so nothing here reads or writes data and
 * nothing needs an entitlement check of its own — the pages behind these
 * links keep whatever gate they already carry, and a gated page still greets
 * its visitor with the same friendly UpgradePrompt it always did.
 *
 * Learn and Lifestyle coaching get a button here on the founder's explicit
 * ask (2026-08-12). Both are real, built pages that patients were reaching
 * only by accident: Learn was promoted out of a Prevention tab for exactly
 * this reason, and /patient/lifestyle had no sidebar entry at all until the
 * same pass, despite the nutrition, weight and activity trackers all linking
 * "back" to it as though it were a hub the patient already knew.
 */

interface QuickAction {
  icon: AppIconName;
  label: string;
  hint: string;
  href: string;
  /** The two logging actions patients repeat most; tinted so the row reads as
   * "do something" first and "go somewhere" second. */
  emphasis?: boolean;
}

const ACTIONS: readonly QuickAction[] = [
  {
    icon: "bp",
    label: "Log a reading",
    hint: "BP, sugar, weight",
    href: "/patient/vitals",
    emphasis: true,
  },
  {
    icon: "medication",
    label: "Today's doses",
    hint: "Tick off your medicines",
    href: "/patient/medications",
    emphasis: true,
  },
  {
    icon: "upload",
    label: "Upload a result",
    hint: "A doctor reads it",
    href: "/patient/labs",
  },
  {
    icon: "messages",
    label: "Message your care team",
    hint: "In the app, always on record",
    href: "/patient/messages",
  },
  {
    icon: "lifestyle",
    label: "Lifestyle coaching",
    hint: "Food, weight, movement",
    href: "/patient/lifestyle",
  },
  {
    icon: "learn",
    label: "Learn",
    hint: "Plain-language health reading",
    href: "/patient/learn",
  },
] as const;

/**
 * Offered only to patients cycle tracking applies to (see
 * shouldOfferCycleTracking), so it is separate from the always-on list above
 * rather than a conditional entry inside it.
 *
 * It earns a place here because the tracker was otherwise three steps deep:
 * Prevention -> the "Programmes" tab -> the cycle card. That is the wrong
 * depth for the one thing on this platform somebody opens most days of the
 * month.
 */
const CYCLE_ACTION: QuickAction = {
  icon: "family",
  label: "Your cycle",
  hint: "Log your period, see what's next",
  href: "/patient/cycle",
};

export function QuickActions({ showCycle = false }: { showCycle?: boolean }) {
  const actions = showCycle ? [...ACTIONS, CYCLE_ACTION] : ACTIONS;
  return (
    <section aria-labelledby="quick-actions-heading">
      <h2
        id="quick-actions-heading"
        className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-charcoal-ink/45 dark:text-night-ink/55"
      >
        Quick actions
      </h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {actions.map((action) => {
          const Icon = APP_ICON[action.icon];
          return (
            <li key={action.href} className="flex">
              <Link
                href={action.href}
                className={cn(
                  "group flex w-full flex-col gap-2 rounded-xl border p-4 transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2",
                  action.emphasis
                    ? "border-brand-green/30 dark:border-brand-green-bright/30 bg-soft-sage/40 dark:bg-brand-green/10 hover:border-brand-green/50 dark:hover:border-brand-green-bright/50 hover:bg-soft-sage dark:hover:bg-brand-green/20"
                    : "border-charcoal-ink/10 dark:border-night-ink/15 bg-white dark:bg-night-card hover:border-brand-green/40 dark:hover:border-brand-green-bright/40 hover:bg-charcoal-ink/[0.03] dark:hover:bg-night-ink/10"
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full",
                    action.emphasis ? "bg-brand-green/15 dark:bg-brand-green/25" : "bg-soft-sage dark:bg-brand-green/20"
                  )}
                >
                  <Icon className="h-4.5 w-4.5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold leading-snug text-charcoal-ink dark:text-night-ink">
                    {action.label}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-charcoal-ink/55 dark:text-night-ink/60">
                    {action.hint}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

import Link from "next/link";
import { APP_ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { PatientFeature } from "@/lib/patient/feature-registry";

/**
 * A group's contents, as a scannable list of what each thing is FOR.
 *
 * This is the answer to "how do we add features without the menu growing
 * forever": the sidebar holds six entries permanently, and everything else
 * lives on one of these pages. Adding a feature adds a row here, which costs
 * the patient nothing, instead of a twenty-second link in a menu they have
 * to read top to bottom every time.
 *
 * Every row carries its one-line blurb. A bare list of labels is what the old
 * flat sidebar already was, and "Check my pack" or "FINDRISC" tells a patient
 * nothing on its own; the line underneath is what makes a directory browsable
 * rather than a second menu.
 *
 * `dimmed` marks a feature the patient's plan does not currently include. It
 * is deliberately still listed and still clickable: the page behind it
 * explains what it is and what it would take to have it, which is far more
 * use than a silent absence, and hiding real features from the person they
 * are for is the exact problem this pass exists to fix.
 */
export function FeatureDirectory({
  features,
  dimmedIds = [],
}: {
  features: readonly PatientFeature[];
  dimmedIds?: readonly string[];
}) {
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {features.map((feature) => {
        const Icon = APP_ICON[feature.icon];
        const dimmed = dimmedIds.includes(feature.id);
        return (
          <li key={feature.id}>
            <Link
              href={feature.href}
              prefetch={false}
              className={cn(
                "group flex h-full items-start gap-3 rounded-xl border border-charcoal-ink/10 p-4 transition-colors",
                "hover:border-brand-green/40 hover:bg-soft-sage/40",
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                  dimmed ? "bg-charcoal-ink/5" : "bg-soft-sage",
                )}
              >
                <Icon
                  className={cn(
                    "h-4.5 w-4.5",
                    dimmed ? "text-charcoal-ink/40" : "text-deep-forest",
                  )}
                  strokeWidth={2}
                />
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-x-2">
                  <span className="font-heading text-sm font-semibold text-charcoal-ink group-hover:text-deep-forest">
                    {feature.label}
                  </span>
                  {dimmed && (
                    <span className="rounded-full bg-charcoal-ink/5 px-2 py-0.5 text-[11px] font-medium text-charcoal-ink/50">
                      On a paid plan
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-sm leading-snug text-charcoal-ink/60">
                  {feature.blurb}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

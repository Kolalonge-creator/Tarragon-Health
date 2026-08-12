import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { NAV_ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * The page header for patient routes that sit OUTSIDE the (sections) route
 * group — Lifestyle coaching, Meals, Weight, Activity, Wellness rewards, the
 * Health Check.
 *
 * Those pages had drifted into three different treatments: some used
 * DashboardPlaceholder, which stamps a "Patient dashboard" subtitle under a
 * greeting (so /patient/weight introduced itself as "Weight — Patient
 * dashboard"); some opened with a bare <h1>; one led with a full-bleed
 * gradient banner. Same product, three front doors. This gives them the same
 * icon + title + description shape as DashboardSection uses inside the
 * sections group, so moving between the two halves of the patient surface
 * stops feeling like moving between two products.
 *
 * `backTo` renders the "← back to the hub" link several of these pages were
 * each hand-rolling in their own corner of the layout.
 */
export function PageHeader({
  title,
  description,
  icon: Icon,
  backTo,
  actions,
  className,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  backTo?: { href: string; label: string };
  /** Right-aligned controls (a primary button, a filter) for pages that need
   * one alongside the title. */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {backTo && (
        <Link
          href={backTo.href}
          className="inline-flex items-center gap-1 text-sm font-medium text-brand-green hover:underline"
        >
          <NAV_ICON.chevronRight className="h-4 w-4 rotate-180" strokeWidth={2} aria-hidden />
          {backTo.label}
        </Link>
      )}
      <div className="flex flex-col gap-4 border-b border-charcoal-ink/10 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          {Icon && (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-soft-sage">
              <Icon className="h-5 w-5 text-deep-forest" strokeWidth={2} />
            </span>
          )}
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink">
              {title}
            </h1>
            {description && (
              <p className="mt-1 max-w-2xl text-sm text-charcoal-ink/65">{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </div>
  );
}

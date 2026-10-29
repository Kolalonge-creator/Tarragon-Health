import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../utils";

/**
 * A warm, specific empty state with one action. Use where a whole page or
 * card has nothing yet; use EmptyHint for a single quiet line inside a
 * filled page. Web twin of the mobile EmptyState.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  body?: React.ReactNode;
  /** The single next step: a Button or Link. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-4 py-8 text-center", className)}>
      {Icon && (
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-soft-sage/70 dark:bg-brand-green/15">
          <Icon className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
        </span>
      )}
      <h2 className="font-heading text-base font-semibold text-charcoal-ink dark:text-night-ink">{title}</h2>
      {body && <p className="max-w-sm text-sm text-charcoal-ink/70 dark:text-night-ink/70">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

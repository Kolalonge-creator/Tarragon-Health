import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Brand-guide-consistent empty state (icon in a soft-sage circle, warm not
 * clinical) — the drop-in replacement for a bare "No X yet." paragraph
 * anywhere in the patient/family-facing dashboard. Pick the icon from
 * `SEMANTIC_ICON`/`NAV_ICON` (lib/icons.ts) so it stays on the sanctioned
 * icon surface, matching whatever the surrounding card is about. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-4 py-10 text-center", className)}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-soft-sage">
        <Icon className="h-6 w-6 text-deep-forest" strokeWidth={2} aria-hidden />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-charcoal-ink">{title}</p>
        {description && (
          <p className="max-w-sm text-sm text-charcoal-ink/60">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

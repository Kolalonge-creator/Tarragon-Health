import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** A labelled band of dashboard cards. Pairs with SectionNav: the `id` is the
 * anchor target, `scroll-mt` clears the sticky topbar + chip row. */
export function DashboardSection({
  id,
  title,
  description,
  icon: Icon,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={cn("scroll-mt-36 space-y-5", className)}
    >
      <div className="flex items-start gap-3 border-b border-charcoal-ink/10 pb-3">
        {Icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-soft-sage">
            <Icon className="h-4.5 w-4.5 text-deep-forest" strokeWidth={2} />
          </span>
        )}
        <div>
          <h2
            id={`${id}-heading`}
            className="font-heading text-lg font-semibold text-charcoal-ink"
          >
            {title}
          </h2>
          {description && <p className="text-sm text-charcoal-ink/60">{description}</p>}
        </div>
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

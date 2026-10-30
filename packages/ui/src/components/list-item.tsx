import * as React from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "../utils";

/**
 * One row in a list: optional icon, title, optional subtitle, optional
 * trailing value. Becomes a link when `href` is given. At least 44px tall so
 * it is a comfortable touch target. Web twin of the mobile ListItem.
 */
export function ListItem({
  title,
  subtitle,
  icon: Icon,
  trailing,
  href,
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  icon?: LucideIcon;
  trailing?: React.ReactNode;
  href?: string;
  className?: string;
}) {
  const inner = (
    <>
      {Icon && <Icon className="h-5 w-5 shrink-0 text-charcoal-ink/60 dark:text-night-ink/60" strokeWidth={2} aria-hidden />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-charcoal-ink dark:text-night-ink">{title}</span>
        {subtitle && <span className="block text-xs text-charcoal-ink/60 dark:text-night-ink/60">{subtitle}</span>}
      </span>
      {trailing && <span className="shrink-0 text-sm text-charcoal-ink/70 dark:text-night-ink/70">{trailing}</span>}
    </>
  );
  const base = "flex min-h-11 items-center gap-3 py-2";
  return href ? (
    <Link href={href} className={cn(base, "rounded-lg hover:bg-charcoal-ink/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green dark:hover:bg-night-ink/10", className)}>
      {inner}
    </Link>
  ) : (
    <div className={cn(base, className)}>{inner}</div>
  );
}

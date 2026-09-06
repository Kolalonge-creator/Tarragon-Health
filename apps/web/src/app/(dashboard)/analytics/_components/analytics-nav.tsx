"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_ICON, type AppIconName } from "@/lib/icons";
import { ANALYTICS_SECTIONS, OVERVIEW_SECTION } from "@/lib/analytics/sections";
import { cn } from "@/lib/utils";

/**
 * Derived from ANALYTICS_SECTIONS, not a list of its own.
 *
 * This nav used to keep a hand-maintained 23-entry array parallel to the
 * analyst sidebar's ANALYTICS_SECTIONS. The two drifted, and the drift was not
 * cosmetic: /analytics/capacity and /analytics/safety existed and were linked
 * from here, but were missing from ANALYTICS_SECTIONS, so the `analyst` role
 * whose whole job is this console could not reach either page. Both lists are
 * now the same list, and analytics-nav.test.ts fails if this file ever grows
 * its own again.
 */
const OVERVIEW_ICON: AppIconName = "dashboard";

export const ANALYTICS_TABS = [
  { href: OVERVIEW_SECTION.href, label: OVERVIEW_SECTION.label, icon: OVERVIEW_ICON },
  ...ANALYTICS_SECTIONS.map((section) => ({
    href: section.href,
    label: section.label,
    icon: section.icon,
  })),
] as const;

export function AnalyticsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-charcoal-ink/10">
      {ANALYTICS_TABS.map((tab) => {
        const active = pathname === tab.href;
        const Icon = APP_ICON[tab.icon];
        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch={false}
            className={cn(
              "flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-brand-green text-brand-green"
                : "border-transparent text-charcoal-ink/60 hover:text-charcoal-ink"
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={2} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

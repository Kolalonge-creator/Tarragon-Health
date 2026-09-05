"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type SettingsTabDef = {
  key: string;
  label: string;
  /** Where clicking the tab navigates to. */
  href: string;
  /** Every route this tab should read as "active" for — its own landing
   * page plus every sub-page it fans out to, since those live at sibling
   * routes rather than nested under `href`. */
  matchHrefs: string[];
};

function isTabActive(pathname: string, matchHrefs: string[]) {
  return matchHrefs.some((href) => pathname === href || pathname.startsWith(`${href}/`));
}

/**
 * A persistent horizontal tab strip for a settings-style section with more
 * sub-pages than belong in the main sidebar — e.g. `/admin/settings`'s ~28
 * pages, grouped into 7 tabs. Modeled on the settings pattern used by
 * payment-processor dashboards: one sidebar entry opens a section, a top tab
 * bar switches between its sub-areas without re-cluttering the sidebar.
 */
export function SettingsTabs({ tabs }: { tabs: SettingsTabDef[] }) {
  const pathname = usePathname();

  return (
    <div className="border-b border-charcoal-ink/10 dark:border-night-ink/15">
      <nav aria-label="Settings sections" className="-mb-px flex gap-6 overflow-x-auto">
        {tabs.map((tab) => {
          const active = isTabActive(pathname, tab.matchHrefs);
          return (
            <Link
              key={tab.key}
              href={tab.href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium transition-colors",
                active
                  ? "border-brand-green text-deep-forest dark:text-brand-green-bright"
                  : "border-transparent text-charcoal-ink/55 hover:border-charcoal-ink/20 hover:text-charcoal-ink dark:text-night-ink/60 dark:hover:border-night-ink/25 dark:hover:text-night-ink"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

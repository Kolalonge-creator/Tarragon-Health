"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type DeskNavItem = {
  label: string;
  href: string;
  /** Active only on this exact path (the Overview). */
  exact?: boolean;
  /** Active only when the queue shows this tab. */
  matchTab?: string;
  /** Lives outside the desk, in the admin or CMO area. */
  external?: boolean;
};

export function isDeskItemActive(item: DeskNavItem, pathname: string, tab: string | null): boolean {
  const path = item.href.split("?")[0];
  if (item.exact) return pathname === path;
  if (item.matchTab) return pathname === path && tab === item.matchTab;
  if (pathname !== path && !pathname.startsWith(`${path}/`)) return false;
  // the worklist entry is not active while the Safety tab (its own entry) is showing
  return tab !== "safety" || path !== "/community-desk/queue";
}

export function DeskNav({ items }: { items: DeskNavItem[] }) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  return (
    <nav aria-label="Community desk sections" className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-charcoal-ink/10 px-1 dark:border-night-ink/15">
        {items.map((item) => {
          const active = isDeskItemActive(item, pathname, tab);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  "inline-flex items-center gap-1 border-b-2 px-3 py-2 text-sm font-medium transition-colors " +
                  (active
                    ? "border-clinical-navy text-clinical-navy dark:border-night-ink dark:text-night-ink"
                    : "border-transparent text-charcoal-ink/65 hover:text-charcoal-ink dark:text-night-ink/65 dark:hover:text-night-ink")
                }
              >
                {item.label}
                {item.external && <span className="sr-only"> (opens your admin area)</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

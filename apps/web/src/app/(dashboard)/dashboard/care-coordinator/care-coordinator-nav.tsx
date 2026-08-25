"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/dashboard/care-coordinator", label: "Overview", exact: true },
  { href: "/dashboard/care-coordinator/outreach", label: "Outreach worklist", exact: false },
  { href: "/dashboard/care-coordinator/follow-ups", label: "Follow-ups", exact: false },
  { href: "/dashboard/care-coordinator/contact-log", label: "Contact log", exact: false },
] as const;

/** Same tab-bar pattern as dashboard/hmo/hmo-nav.tsx and
 * dashboard/corporate/corporate-nav.tsx — matches the "Tarragon Health Care
 * Coordinator Portal" design's sidebar-of-sections, adapted to this app's
 * in-page top-tab convention (the global sidebar already carries the role,
 * per lib/navigation.ts). */
export function CareCoordinatorNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-charcoal-ink/10">
      {TABS.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-brand-green text-brand-green"
                : "border-transparent text-charcoal-ink/60 hover:text-charcoal-ink"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

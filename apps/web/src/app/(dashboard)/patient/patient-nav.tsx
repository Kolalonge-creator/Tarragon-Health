"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ICON, SEMANTIC_ICON } from "@/lib/icons";

const TABS = [
  { href: "/patient", label: "Overview", icon: NAV_ICON.dashboard, exact: true },
  { href: "/patient/vitals", label: "Vitals & symptoms", icon: SEMANTIC_ICON.bp, exact: false },
  { href: "/patient/medications", label: "Medications", icon: SEMANTIC_ICON.medication, exact: false },
  { href: "/patient/prevention", label: "Prevention", icon: SEMANTIC_ICON.preventive, exact: false },
  { href: "/patient/labs", label: "Labs & bookings", icon: SEMANTIC_ICON.labs, exact: false },
  { href: "/patient/care", label: "Care & support", icon: SEMANTIC_ICON.clinicianFollowUp, exact: false },
  { href: "/patient/profile", label: "Profile", icon: NAV_ICON.settings, exact: false },
] as const;

/** Real route tabs — replaces the old anchor-scroll SectionNav. Each tab is a
 * distinct page; only the active one's content is ever fetched/rendered,
 * matching how every other role's dashboard in this app already works
 * (see analytics/finance's own AnalyticsNav-style tab bar). */
export function PatientNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Dashboard sections"
      className="sticky top-[57px] z-30 -mx-4 border-b border-charcoal-ink/10 bg-warm-ivory/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8"
    >
      <div className="flex gap-1.5 overflow-x-auto whitespace-nowrap py-0.5 [scrollbar-width:none]">
        {TABS.map((tab) => {
          const active = tab.exact
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-deep-forest text-white"
                  : "text-charcoal-ink/60 hover:bg-charcoal-ink/5 hover:text-charcoal-ink"
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={2} />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/analytics", label: "Overview", icon: NAV_ICON.dashboard },
  { href: "/analytics/acquisition", label: "Acquisition", icon: NAV_ICON.acquisition },
  { href: "/analytics/engagement", label: "Engagement", icon: NAV_ICON.engagement },
  { href: "/analytics/users", label: "Users", icon: NAV_ICON.users },
  { href: "/analytics/business", label: "Business", icon: NAV_ICON.business },
  { href: "/analytics/financial", label: "Financial", icon: NAV_ICON.financial },
  { href: "/analytics/investor", label: "Investor", icon: NAV_ICON.investor },
  { href: "/analytics/accounting", label: "Accounting", icon: NAV_ICON.accounting },
  { href: "/analytics/population", label: "Population health", icon: NAV_ICON.population },
  { href: "/analytics/outcomes", label: "Clinical outcomes", icon: NAV_ICON.outcomes },
  { href: "/analytics/operations", label: "Operations", icon: NAV_ICON.operations },
  { href: "/analytics/facilities", label: "Facilities", icon: NAV_ICON.facilities },
  { href: "/analytics/doctors", label: "Doctor performance", icon: NAV_ICON.doctors },
  { href: "/analytics/team", label: "Team activity", icon: NAV_ICON.team },
  { href: "/analytics/patient-activity", label: "Patient activity", icon: NAV_ICON.patientActivity },
  { href: "/analytics/governance", label: "Governance", icon: NAV_ICON.governance },
  { href: "/analytics/audit", label: "Audit log", icon: NAV_ICON.auditLog },
] as const;

export function AnalyticsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-charcoal-ink/10">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        const Icon = tab.icon;
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

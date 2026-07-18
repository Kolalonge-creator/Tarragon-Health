"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Building,
  Calculator,
  Gavel,
  Globe,
  HeartPulse,
  LayoutDashboard,
  Landmark,
  ScrollText,
  Clock4,
  Stethoscope,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/analytics", label: "Overview", icon: LayoutDashboard },
  { href: "/analytics/acquisition", label: "Acquisition", icon: Globe },
  { href: "/analytics/engagement", label: "Engagement", icon: Users },
  { href: "/analytics/users", label: "Users", icon: UserRound },
  { href: "/analytics/business", label: "Business", icon: BarChart3 },
  { href: "/analytics/financial", label: "Financial", icon: Wallet },
  { href: "/analytics/investor", label: "Investor", icon: Landmark },
  { href: "/analytics/accounting", label: "Accounting", icon: Calculator },
  { href: "/analytics/population", label: "Population health", icon: HeartPulse },
  { href: "/analytics/outcomes", label: "Clinical outcomes", icon: Stethoscope },
  { href: "/analytics/operations", label: "Operations", icon: Activity },
  { href: "/analytics/facilities", label: "Facilities", icon: Building },
  { href: "/analytics/doctors", label: "Doctor performance", icon: Stethoscope },
  { href: "/analytics/team", label: "Team activity", icon: Clock4 },
  { href: "/analytics/governance", label: "Governance", icon: Gavel },
  { href: "/analytics/audit", label: "Audit log", icon: ScrollText },
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

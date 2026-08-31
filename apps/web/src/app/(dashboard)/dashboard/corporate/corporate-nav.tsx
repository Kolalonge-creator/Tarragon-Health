"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/dashboard/corporate", label: "Overview", exact: true },
  { href: "/dashboard/corporate/reports", label: "Reports & outcomes", exact: false },
  { href: "/dashboard/corporate/programmes", label: "Programmes", exact: false },
] as const;

export function CorporateNav() {
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

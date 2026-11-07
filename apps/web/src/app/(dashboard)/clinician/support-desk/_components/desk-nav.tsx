"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/clinician/support-desk", label: "Overview" },
  { href: "/clinician/support-desk/queue", label: "Queue" },
  { href: "/clinician/support-desk/handoffs", label: "Hand-offs" },
  { href: "/clinician/support-desk/templates", label: "Reply templates" },
  { href: "/clinician/support-desk/settings", label: "Targets and hours" },
];

export function DeskNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Support desk" className="flex flex-wrap gap-2 border-b border-charcoal-ink/10 pb-2 dark:border-night-ink/15">
      {LINKS.map((l) => {
        const active = l.href === "/clinician/support-desk" ? pathname === l.href : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition",
              active
                ? "bg-soft-sage text-brand-green dark:bg-brand-green/20 dark:text-brand-green-bright"
                : "text-charcoal-ink/70 hover:bg-charcoal-ink/5 dark:text-night-ink/70 dark:hover:bg-night-ink/10",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

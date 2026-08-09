"use client";

import { usePathname } from "next/navigation";
import { ANALYTICS_SECTIONS, OVERVIEW_SECTION } from "@/lib/analytics/sections";

/** Per-route title + subtitle, matching the "Tarragon Health Analyst
 * Dashboard" design's dynamic header (the mock's `{{ pageTitle }}` /
 * `{{ pageSubtitle }}`). Falls back to Overview's copy for any unmatched
 * path so a stale link never renders blank. */
export function AnalyticsPageHeader() {
  const pathname = usePathname();
  const section = ANALYTICS_SECTIONS.find((s) => s.href === pathname);
  const label = section?.label ?? OVERVIEW_SECTION.label;
  const subtitle = section?.subtitle ?? OVERVIEW_SECTION.subtitle;

  return (
    <div>
      <h1 className="font-heading text-2xl font-semibold text-clinical-navy">{label}</h1>
      <p className="text-sm text-charcoal-ink/60">{subtitle}</p>
    </div>
  );
}

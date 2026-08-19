"use client";

import { usePathname } from "next/navigation";

const TITLES: Record<string, { title: string; subtitle: string }> = {
  "/dashboard/corporate": {
    title: "Corporate admin",
    subtitle: "Enrolment, contract performance and anonymised workforce analytics.",
  },
  "/dashboard/corporate/reports": {
    title: "Reports & outcomes",
    subtitle: "Age segmentation, outcome evidence, medication and lifestyle outcomes, and shareable snapshots.",
  },
};

/** Per-tab title + subtitle, matching the "Tarragon Health Corporate Admin
 * Portal" design's dynamic header (the mock's `{{ pageTitle }}` /
 * `{{ pageSubtitle }}`, same pattern as dashboard/hmo/hmo-page-header.tsx).
 * Falls back to the Overview copy for any unmatched path so a stale link
 * never renders blank. */
export function CorporatePageHeader() {
  const pathname = usePathname();
  const { title, subtitle } = TITLES[pathname] ?? TITLES["/dashboard/corporate"];

  return (
    <div>
      <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{title}</h1>
      <p className="text-sm text-charcoal-ink/60">{subtitle}</p>
    </div>
  );
}

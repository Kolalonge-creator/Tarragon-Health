"use client";

import { usePathname } from "next/navigation";

const TITLES: Record<string, { title: string; subtitle: string }> = {
  "/dashboard/hmo": {
    title: "HMO admin",
    subtitle: "Enrolment, contract performance and anonymised member analytics.",
  },
  "/dashboard/hmo/reports": {
    title: "Reports & outcomes",
    subtitle: "Claims impact, medication and lifestyle outcomes, and shareable snapshots.",
  },
};

/** Per-tab title + subtitle, matching the "Tarragon Health HMO Admin Portal"
 * design's dynamic header (the mock's `{{ pageTitle }}` / `{{ pageSubtitle }}`,
 * same pattern as analytics/_components/page-header.tsx). Falls back to the
 * Overview copy for any unmatched path so a stale link never renders blank. */
export function HmoPageHeader() {
  const pathname = usePathname();
  const { title, subtitle } = TITLES[pathname] ?? TITLES["/dashboard/hmo"];

  return (
    <div>
      <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{title}</h1>
      <p className="text-sm text-charcoal-ink/60">{subtitle}</p>
    </div>
  );
}

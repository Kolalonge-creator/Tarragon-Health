"use client";

import { usePathname } from "next/navigation";

const TITLES: Record<string, { title: string; subtitle: string }> = {
  "/dashboard/care-coordinator": {
    title: "Overview",
    subtitle: "Today's coordinator snapshot.",
  },
  "/dashboard/care-coordinator/outreach": {
    title: "Outreach worklist",
    subtitle: "Contact patients surfaced by risk scores and care gaps, and note the outcome.",
  },
  "/dashboard/care-coordinator/support-requests": {
    title: "Support requests",
    subtitle: "Help patients have asked for, and where each request has got to.",
  },
  "/dashboard/care-coordinator/follow-ups": {
    title: "Follow-ups",
    subtitle: "Self-arranged lab tests that need a nudge: the patient books and pays their own lab.",
  },
  "/dashboard/care-coordinator/programme-tasks": {
    title: "Programme tasks",
    subtitle: "Chase-ups and bookings due on the 12-week chronic-care programme.",
  },
  "/dashboard/care-coordinator/contact-log": {
    title: "Contact log",
    subtitle: "A record of call and WhatsApp outreach attempts, patient by patient.",
  },
};

/** Per-tab title + subtitle, matching the "Tarragon Health Care Coordinator
 * Portal" design's dynamic header (the mock's `{{ pageTitle }}` /
 * `{{ pageSubtitle }}`) — same pattern as dashboard/hmo/hmo-page-header.tsx.
 *
 * There must be an entry here for every tab in care-coordinator-nav.tsx.
 * Support requests and Programme tasks were both missing, so each rendered
 * "Overview: Today's coordinator snapshot" above a completely different
 * worklist. The fallback exists for a stale bookmark, not for a live tab. */
export function CareCoordinatorPageHeader() {
  const pathname = usePathname();
  const { title, subtitle } = TITLES[pathname] ?? TITLES["/dashboard/care-coordinator"];

  return (
    <div>
      <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{title}</h1>
      <p className="text-sm text-charcoal-ink/60">{subtitle}</p>
    </div>
  );
}

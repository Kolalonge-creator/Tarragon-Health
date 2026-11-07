import type { WorkCategory } from "./work-items";

/**
 * CC-3 (2026-11-07): the coordination workspace's own menu, grouped as the founder's brief asks, mapped to pages that already exist.
 * Nothing is listed that would bounce: every /clinician/* link here is on proxy.ts's coordinator allow-list, and a doctor may open
 * all of them anyway.
 */
export type WorkspaceCount = "mine" | WorkCategory;

export type WorkspaceLink = {
  href: string;
  label: string;
  /** One line under the page title in the workspace header. */
  subtitle: string;
  icon:
    | "dashboard"
    | "worklist"
    | "patients"
    | "booking"
    | "outreach"
    | "followUp"
    | "programme"
    | "labs"
    | "messages"
    | "support"
    | "contactLog"
    | "operations"
    | "escalation"
    | "queue"
    | "community";
  exact?: boolean;
  count?: WorkspaceCount;
};

export type WorkspaceSection = { title: string; links: WorkspaceLink[] };

const BASE = "/dashboard/care-coordinator";

export function workspaceSections(opts: { showCommunity: boolean }): WorkspaceSection[] {
  const sections: WorkspaceSection[] = [
    {
      title: "Overview",
      links: [
        { href: BASE, label: "Command centre", subtitle: "What needs doing today, and where every care journey has got to.", icon: "dashboard", exact: true },
        { href: `${BASE}/worklist`, label: "My worklist", subtitle: "Every open coordination task in one list: outreach, follow-ups, support and programme tasks.", icon: "worklist", count: "mine" },
      ],
    },
    {
      title: "Patients",
      links: [
        { href: `${BASE}/patients`, label: "My patients", subtitle: "Patients you coordinate, with their open work, next appointment and last contact.", icon: "patients" },
        { href: `${BASE}/book-for-patient`, label: "Book for a patient", subtitle: "Book an appointment for a patient on a phone call who cannot use the app.", icon: "booking" },
      ],
    },
    {
      title: "Coordination",
      links: [
        { href: `${BASE}/outreach`, label: "Outreach", subtitle: "Contact patients surfaced by risk scores and care gaps, and note the outcome.", icon: "outreach", count: "outreach" },
        { href: `${BASE}/follow-ups`, label: "Result follow-ups", subtitle: "Self-arranged tests not yet uploaded: the patient books and pays their own lab.", icon: "followUp", count: "follow_up" },
        { href: `${BASE}/programme-tasks`, label: "Programme tasks", subtitle: "Chase-ups and bookings due on the 12-week chronic-care programme.", icon: "programme", count: "programme" },
        { href: `${BASE}/lab-reports`, label: "Lab reports", subtitle: "Upload a report a laboratory sent to Tarragon. It is held for a doctor before the patient sees it.", icon: "labs" },
      ],
    },
    {
      title: "Communication",
      links: [
        { href: `${BASE}/messages`, label: "Patient messages", subtitle: "Conversations with patients in the app. Clinical questions go on to a doctor.", icon: "messages" },
        { href: `${BASE}/support-requests`, label: "Support requests", subtitle: "Help patients have asked for, and where each request has got to.", icon: "support", count: "support" },
        { href: `${BASE}/contact-log`, label: "Contact log", subtitle: "A record of call attempts, patient by patient.", icon: "contactLog" },
      ],
    },
    {
      title: "Operations",
      links: [
        { href: `${BASE}/operations`, label: "Care operations", subtitle: "What is waiting across messages, alerts and monthly meetings, and who holds it.", icon: "operations" },
        { href: "/clinician/queue", label: "Task queue", subtitle: "Queue tasks offered to you, including coordinator-level ones.", icon: "queue", count: "queue" },
        { href: "/clinician/escalations", label: "Escalations", subtitle: "Raise a clinical concern to a doctor and see where it has got to.", icon: "escalation" },
      ],
    },
  ];
  if (opts.showCommunity) {
    sections[3].links.push({
      href: `${BASE}/community`,
      label: "Community",
      subtitle: "Check posts held for review and handle safety signals. You see handles, never names.",
      icon: "community",
    });
  }
  return sections;
}

export function linkIsActive(pathname: string, link: Pick<WorkspaceLink, "href" | "exact">): boolean {
  return link.exact ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
}

/** The link the current page belongs to; the command centre for anything unknown (a stale bookmark). */
export function activeLink(pathname: string, sections: WorkspaceSection[]): { section: string; link: WorkspaceLink } {
  for (const s of sections) {
    for (const l of s.links) if (linkIsActive(pathname, l)) return { section: s.title, link: l };
  }
  return { section: sections[0].title, link: sections[0].links[0] };
}

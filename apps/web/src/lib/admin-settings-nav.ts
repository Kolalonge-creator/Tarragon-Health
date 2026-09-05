import type { LucideIcon } from "lucide-react";
import { NAV_ICON, SEMANTIC_ICON } from "@/lib/icons";
import type { CallerPermissions } from "@/lib/auth/permissions";

export type AdminSettingsItem = {
  href: string;
  label: string;
  blurb: string;
  icon: LucideIcon;
  visible: (perms: CallerPermissions) => boolean;
};

export type AdminSettingsTab = {
  key: string;
  label: string;
  /** Landing page for the tab itself — where clicking the tab navigates to. */
  href: string;
  items: AdminSettingsItem[];
};

const adminOnly = (perms: CallerPermissions) => perms.isSuperAdmin;

const anyOf =
  (...keys: string[]) =>
  (perms: CallerPermissions) =>
    perms.isSuperAdmin || keys.some((k) => perms.keys.has(k));

/**
 * Every admin settings page, grouped into the tabs rendered by
 * `/admin/settings/layout.tsx` — originally replacing the ~28 individual
 * links that used to be split between the main sidebar (15 of them) and
 * `/admin` home-page tiles (a different, overlapping 21), two inconsistent
 * lists neither of which covered all of them. `visible` mirrors each
 * destination page's own actual gate (checked directly in each page.tsx),
 * not the looser permission keys some of those old lists used — several
 * pages (protocols, cv-risk-config, subscriptions, clinical-staff,
 * broadcasts, and others) hard-gate to `profile.role === "admin"` even
 * though a same-named delegable permission key exists in `PERMISSION_KEYS`,
 * so showing this tab item to a delegated non-admin member would be a dead
 * link. New settings pages should be added here, not as a direct sidebar
 * link — see the "admin" case in `navigation.ts`.
 */
export const ADMIN_SETTINGS_TABS: AdminSettingsTab[] = [
  {
    key: "organisation",
    label: "Organisation",
    href: "/admin/settings/organisation",
    items: [
      {
        href: "/admin/settings/company-profile",
        label: "Company & legal profile",
        blurb: "Registered name, RC/TIN, directors, and auditor — the letterhead facts on every filing.",
        icon: SEMANTIC_ICON.corporate,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/service-regions",
        label: "Service regions",
        blurb: "Turn TarragonHealth on, one Nigerian state at a time.",
        icon: NAV_ICON.region,
        visible: adminOnly,
      },
    ],
  },
  {
    key: "access",
    label: "People & Access",
    href: "/admin/settings/access",
    items: [
      {
        href: "/admin/settings/members",
        label: "Members & access",
        blurb: "Create logins, assign roles, and delegate specific capabilities.",
        icon: NAV_ICON.members,
        visible: anyOf("users.provision", "users.roles.assign", "users.permissions.grant", "roles.manage"),
      },
      {
        href: "/admin/settings/clinical-staff",
        label: "Clinical staff",
        blurb: "Add and verify every MDCN/NMCN-credentialed doctor.",
        icon: SEMANTIC_ICON.clinicianFollowUp,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/provider-restrictions",
        label: "Provider restrictions",
        blurb: "A staged, reason-coded suspension workflow for clinical staff.",
        icon: NAV_ICON.warning,
        visible: adminOnly,
      },
    ],
  },
  {
    key: "partners",
    label: "Partner Network",
    href: "/admin/settings/partners",
    items: [
      {
        href: "/admin/settings/partners",
        label: "Labs, pharmacies & specialists",
        blurb: "The partner network patients book against.",
        icon: SEMANTIC_ICON.labs,
        visible: anyOf(
          "partners.labs.manage",
          "partners.pharmacies.manage",
          "partners.facilities.manage",
          "partners.specialists.manage"
        ),
      },
      {
        href: "/admin/settings/logistics-partners",
        label: "Home visit & delivery",
        blurb: "Home sample-collection and courier partners, by region.",
        icon: SEMANTIC_ICON.logistics,
        visible: anyOf("partners.home_visit.manage", "partners.logistics.manage"),
      },
      {
        href: "/admin/settings/commissions",
        label: "Commission tracking",
        blurb: "Every partner-network commission earned, owed, and paid.",
        icon: SEMANTIC_ICON.commission,
        visible: adminOnly,
      },
    ],
  },
  {
    key: "clinical-protocols",
    label: "Clinical Protocols",
    href: "/admin/settings/clinical-protocols",
    items: [
      {
        href: "/admin/settings/protocols",
        label: "Clinical protocols",
        blurb: "The signed record behind every doctor-reviewed claim.",
        icon: SEMANTIC_ICON.preventive,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/cv-risk-config",
        label: "CV-risk (cholesterol) config",
        blurb: "Lipid targets and cardiovascular-risk thresholds.",
        icon: SEMANTIC_ICON.bp,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/risk-questionnaire-config",
        label: "Risk questionnaire configuration",
        blurb: "The prevention risk assessment's questions and scoring rules.",
        icon: NAV_ICON.review,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/escalation-slas",
        label: "Escalation SLAs",
        blurb: "The contact-window config every clinician_alert trigger reads from.",
        icon: SEMANTIC_ICON.escalation,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/vaccination-schedule",
        label: "Vaccination schedule",
        blurb: "The reference schedule behind due/overdue vaccination reminders.",
        icon: NAV_ICON.vaccination,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/conditions",
        label: "Chronic conditions",
        blurb: "The phased chronic-disease catalogue.",
        icon: SEMANTIC_ICON.carePlan,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/triage-protocols",
        label: "Symptom triage protocols",
        blurb: "Red-flag thresholds and questionnaire branching for the symptom checker, versioned and Director-signed.",
        icon: NAV_ICON.siren,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/clinical-rules",
        label: "Clinical rules engine",
        blurb: "Governed deployment and rollback for every configurable clinical rule version.",
        icon: NAV_ICON.governance,
        visible: adminOnly,
      },
    ],
  },
  {
    key: "patient-engagement",
    label: "Patient Engagement",
    href: "/admin/settings/patient-engagement",
    items: [
      {
        href: "/admin/settings/prevention-campaigns",
        label: "Prevention campaigns",
        blurb: "Time-boxed population health initiatives, e.g. Heart Health Month.",
        icon: SEMANTIC_ICON.preventive,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/health-education",
        label: "Health education library",
        blurb: "The clinician-reviewed learning catalogue.",
        icon: NAV_ICON.ledger,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/vitals-reminders",
        label: "Vitals reminder cadence",
        blurb: "How often patients are nudged to log vitals.",
        icon: NAV_ICON.bell,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/medication-refills",
        label: "Medication refill reminders",
        blurb: "Days before a refill date patients get reminded.",
        icon: SEMANTIC_ICON.medication,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/ai-coach",
        label: "AI Health Coach",
        blurb: "Internal testing, ahead of patient release.",
        icon: SEMANTIC_ICON.aiCoach,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/wellness",
        label: "Wellness rewards",
        blurb: "Points, badges, and challenges patients earn for healthy habits.",
        icon: NAV_ICON.wellness,
        visible: adminOnly,
      },
    ],
  },
  {
    key: "commerce",
    label: "Commerce & Billing",
    href: "/admin/settings/commerce",
    items: [
      {
        href: "/admin/settings/subscriptions",
        label: "Retired subscription catalogue",
        blurb: "Read-only history of the plans and add-ons retired in 2026.",
        icon: SEMANTIC_ICON.billing,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/vouchers",
        label: "Care vouchers",
        blurb: "Validity windows, extensions, and reissues.",
        icon: NAV_ICON.payables,
        visible: anyOf("vouchers.manage"),
      },
      {
        href: "/admin/settings/screening-days",
        label: "Group screening days",
        blurb: "Confirm requests, set the cohort discount, and issue attendee vouchers.",
        icon: SEMANTIC_ICON.booking,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/lab-result-consult-pricing",
        label: "Lab-result consult fee",
        blurb: "The fee charged for a doctor consult triggered by an abnormal lab result.",
        icon: SEMANTIC_ICON.billing,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/outcomes-contracts",
        label: "Fee-at-risk contracts",
        blurb: "Review and approve HMO/corporate-proposed outcomes contract terms.",
        icon: NAV_ICON.outcomes,
        visible: adminOnly,
      },
    ],
  },
  {
    key: "platform",
    label: "Platform & Compliance",
    href: "/admin/settings/platform",
    items: [
      {
        href: "/admin/settings/broadcasts",
        label: "Broadcasts & announcements",
        blurb: "Email/WhatsApp/SMS to a targeted audience.",
        icon: NAV_ICON.broadcast,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/resources",
        label: "Resources hub",
        blurb: "Documents and links shared across the care team.",
        icon: NAV_ICON.messages,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/impact-metrics",
        label: "Public impact dashboard",
        blurb: "What shows on the public /impact page.",
        icon: SEMANTIC_ICON.impact,
        visible: anyOf("impact_metrics.manage"),
      },
      {
        href: "/admin/settings/integrations",
        label: "API keys & integrations",
        blurb: "Inbound partner keys and outbound partner APIs.",
        icon: SEMANTIC_ICON.family,
        visible: anyOf("integrations.manage"),
      },
      {
        href: "/admin/settings/protocol-api",
        label: "Protocol API",
        blurb: "License escalation/risk/protocol machinery to partners.",
        icon: NAV_ICON.settings,
        visible: anyOf("integrations.manage"),
      },
      {
        href: "/admin/settings/data-breach-incidents",
        label: "Data breach incidents",
        blurb: "The NDPA 72-hour notification clock, tracked.",
        icon: NAV_ICON.compliance,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/feature-flags",
        label: "Feature flags",
        blurb: "Turn a feature on or off platform-wide without a deploy.",
        icon: NAV_ICON.flag,
        visible: anyOf("feature_flags.manage"),
      },
      {
        href: "/admin/settings/platform-modules",
        label: "Platform modules",
        blurb: "The activation switch for a dormant module, e.g. the insurer or provider-organisation platform.",
        icon: NAV_ICON.settings,
        visible: adminOnly,
      },
      {
        href: "/admin/settings/notification-templates",
        label: "Notification templates",
        blurb: "The wording behind every WhatsApp/SMS/email/in-app reminder and alert.",
        icon: NAV_ICON.messages,
        visible: anyOf("notification_templates.manage"),
      },
      {
        href: "/admin/settings/ai-governance",
        label: "AI governance",
        blurb: "Oversight and audit trail for every AI-assisted clinical or operational decision.",
        icon: SEMANTIC_ICON.aiCoach,
        visible: anyOf("ai_governance.manage"),
      },
    ],
  },
];

export function getVisibleAdminSettingsTabs(perms: CallerPermissions) {
  return ADMIN_SETTINGS_TABS.map((tab) => ({
    ...tab,
    items: tab.items.filter((item) => item.visible(perms)),
  })).filter((tab) => tab.items.length > 0);
}

export function getVisibleItemsForTab(key: string, perms: CallerPermissions) {
  const tab = ADMIN_SETTINGS_TABS.find((t) => t.key === key);
  if (!tab) return [];
  return tab.items.filter((item) => item.visible(perms));
}

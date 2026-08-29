import type { AppIconName } from "@/lib/icons";

/**
 * The 16 Platform Analytics categories — single source of truth for the
 * `analyst` sidebar (lib/navigation.ts), the per-page header
 * (analytics/_components/page-header.tsx), and the Overview page's grouped
 * quick-link cards (analytics/_components/overview-dashboard.tsx). Group
 * order/labels and per-category copy match the "Tarragon Health Analyst
 * Dashboard" design.
 */
export type AnalyticsGroup = "Financial" | "People" | "Growth" | "Operations" | "Governance";

export const ANALYTICS_GROUP_ORDER: AnalyticsGroup[] = [
  "Financial",
  "People",
  "Growth",
  "Operations",
  "Governance",
];

export interface AnalyticsSection {
  id: string;
  href: string;
  label: string;
  subtitle: string;
  icon: AppIconName;
  group: AnalyticsGroup;
}

export const ANALYTICS_SECTIONS: AnalyticsSection[] = [
  {
    id: "business",
    href: "/analytics/business",
    label: "Business",
    subtitle: "Accounts, patient growth and organisation mix",
    icon: "business",
    group: "Financial",
  },
  {
    id: "financial",
    href: "/analytics/financial",
    label: "Financial",
    subtitle: "MRR, subscriptions, churn and receivables",
    icon: "financial",
    group: "Financial",
  },
  {
    id: "accounting",
    href: "/analytics/accounting",
    label: "Accounting",
    subtitle: "Revenue recognition, receivables and reconciliation",
    icon: "accounting",
    group: "Financial",
  },
  {
    id: "investor",
    href: "/analytics/investor",
    label: "Investor",
    subtitle: "ARR, retention, unit economics, burn and runway",
    icon: "investor",
    group: "Financial",
  },
  {
    id: "users",
    href: "/analytics/users",
    label: "Users",
    subtitle: "Patient base growth, retention and activity",
    icon: "users",
    group: "People",
  },
  {
    id: "doctors",
    href: "/analytics/doctors",
    label: "Doctors",
    subtitle: "Clinician roster, verification and workload",
    icon: "doctors",
    group: "People",
  },
  {
    id: "team",
    href: "/analytics/team",
    label: "Team",
    subtitle: "Internal staff activity and session time",
    icon: "team",
    group: "People",
  },
  {
    id: "engagement",
    href: "/analytics/engagement",
    label: "Engagement",
    subtitle: "How patients use the app, day to day",
    icon: "engagement",
    group: "Growth",
  },
  {
    id: "acquisition",
    href: "/analytics/acquisition",
    label: "Acquisition",
    subtitle: "Traffic, channels and conversion funnel",
    icon: "acquisition",
    group: "Growth",
  },
  {
    id: "operations",
    href: "/analytics/operations",
    label: "Operations",
    subtitle: "Escalation and notification-delivery throughput",
    icon: "operations",
    group: "Operations",
  },
  {
    id: "support",
    href: "/analytics/support",
    label: "Support",
    subtitle: "Ticket volume, response/resolution time, and complaints",
    icon: "helpCenter",
    group: "Operations",
  },
  {
    id: "patient-activity",
    href: "/analytics/patient-activity",
    label: "Patient activity",
    subtitle: "Forensic per-patient engagement lookup",
    icon: "patientActivity",
    group: "Operations",
  },
  {
    id: "facilities",
    href: "/analytics/facilities",
    label: "Facilities",
    subtitle: "Utilization across labs, pharmacies and hospitals",
    icon: "facilities",
    group: "Operations",
  },
  {
    id: "outcomes",
    href: "/analytics/outcomes",
    label: "Outcomes",
    subtitle: "Clinical control rates and escalation quality",
    icon: "outcomes",
    group: "Governance",
  },
  {
    id: "governance",
    href: "/analytics/governance",
    label: "Governance",
    subtitle: "Credentials, consent coverage and risk register",
    icon: "governance",
    group: "Governance",
  },
  {
    id: "population",
    href: "/analytics/population",
    label: "Population",
    subtitle: "Conditions, risk tiers and care gaps",
    icon: "population",
    group: "Governance",
  },
  {
    id: "audit",
    href: "/analytics/audit",
    label: "Audit",
    subtitle: "Every platform event, filterable and exportable",
    icon: "audit",
    group: "Governance",
  },
];

export const OVERVIEW_SECTION = {
  href: "/analytics",
  label: "Overview",
  subtitle: "Platform-wide analytics, read-only",
} as const;

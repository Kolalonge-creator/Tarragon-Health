import type { AppIconName } from "@/lib/icons";
import { ANALYTICS_GROUP_ORDER, ANALYTICS_SECTIONS } from "@/lib/analytics/sections";

/** One sidebar link. `exact` marks role-root dashboards so `/patient` doesn't
 * light up while the user is on `/patient/family`. */
export interface NavItem {
  label: string;
  href: string;
  icon: AppIconName;
  exact?: boolean;
  /** Renders with the clinical-red treatment instead of the normal
   * active/hover states — reserved for safety-critical links (currently just
   * the patient's Emergency card) that should visually stand apart from
   * routine navigation, matching how the design itself calls it out. */
  variant?: "danger";
  /** Promotes this link into the phone bottom tab bar (see AppShell). Only the
   * first `MAX_PRIMARY_NAV_ITEMS` flagged items are used, in declaration
   * order; everything else stays reachable through the bar's More button,
   * which opens the same full drawer as before. A role that flags nothing
   * gets no bottom bar at all, so this is purely additive per role. */
  primary?: boolean;
  /** Short label for the bottom tab bar, where a full label like
   * "Vitals & symptoms" cannot fit. Falls back to `label`. */
  shortLabel?: string;
}

/** How many `primary` links the phone bottom bar shows before the More
 * button. Four plus More keeps every target above the ~44px tap-target floor
 * on a 320px-wide screen. */
export const MAX_PRIMARY_NAV_ITEMS = 4;

/** A labelled group of sidebar links. `label` is omitted for the top group. */
export interface NavSection {
  label?: string;
  items: NavItem[];
  /**
   * The group's own directory page. When set, the sidebar renders the group
   * as ONE link at rest and expands its items only while the patient is
   * inside it (see AppShell's SidebarNav) — which is what keeps the resting
   * menu at six entries however many features the registry grows to. A
   * section without this keeps the old always-expanded behaviour, so every
   * staff role below is untouched.
   */
  groupHref?: string;
}

/** Role → sidebar navigation. Routes listed here must be real pages; pages
 * that gate on entitlement/permission still render a friendly gate, so a
 * link is safe even when the caller lacks the feature. */
export function getNavSections(
  role: string | null | undefined,
  /**
   * False means this account funds somebody else's care and receives none
   * here. Reordering the patient menu was not enough: such a person was still
   * handed a sidebar of Prevention, Health Check, Health Passport, Lifestyle
   * coaching and Wellness rewards — nine links about a body we are not looking
   * after — which is what makes the product feel like it was built for
   * somebody else and lent to them. They get their own short menu instead.
   *
   * Somebody who is BOTH a supporter and a patient falls through to the full
   * patient menu, which still carries People you support (see below). The
   * two are independent, so there is no combined case to special-case.
   */
  receivesCare?: boolean | null,
): NavSection[] {
  switch (role) {
    case "patient":
      if (receivesCare === false) {
        return [
          {
            items: [
              {
                label: "People you support",
                href: "/patient/supporting",
                icon: "parentCare",
                primary: true,
                shortLabel: "People",
              },
              {
                label: "Messages",
                href: "/patient/messages",
                icon: "messages",
                primary: true,
                shortLabel: "Messages",
              },
              {
                label: "Your people",
                href: "/patient/family",
                icon: "family",
                primary: true,
                shortLabel: "Family",
              },
              // Not "Subscription" — a supporter has no plan of their own. This
              // is where they see what they are paying for other people.
              {
                label: "Payments",
                href: "/patient/subscription",
                icon: "billing",
                primary: true,
                shortLabel: "Payments",
              },
            ],
          },
        ];
      }
      // Six entries, permanently. Everything else lives on the group
      // directory pages (see lib/patient/feature-registry.ts).
      //
      // The 2026-08-12 pass banded a flat fifteen-link list into four labelled
      // groups, which was right and is kept. But the list itself kept growing
      // — twenty-one links by 2026-09-02 — and a labelled band of six links is
      // still six links a patient reads past every time. Worse, the menu was
      // the app's ONLY map, so anything not in it (cycle tracking, the
      // FINDRISC check, Check my pack, foot risk, data rights) was reachable
      // only by knowing where it already was.
      //
      // So the menu stops being the map. A group is now a real page listing
      // its features with a line each about what they are for, search reaches
      // any of them by name, and the sidebar's job shrinks to "which part of
      // my life is this". The bands below are exactly FEATURE_GROUPS, and
      // `groupHref` is what AppShell expands in place when the patient is
      // inside that part of the app: at rest six links, in context the
      // siblings you would want to move between, and never the whole app at
      // once.
      //
      // The four `primary` links are unchanged, so the phone bottom bar and
      // the everyday one-tap routes are exactly as they were.
      return [
        {
          items: [
            {
              label: "Overview",
              href: "/patient",
              icon: "dashboard",
              exact: true,
              primary: true,
              shortLabel: "Home",
            },
          ],
        },
        {
          label: "Your health",
          groupHref: "/patient/health",
          items: [
            {
              label: "Vitals & symptoms",
              href: "/patient/vitals",
              icon: "bp",
              primary: true,
              shortLabel: "Vitals",
            },
            {
              label: "Medications",
              href: "/patient/medications",
              icon: "medication",
              primary: true,
              shortLabel: "Meds",
            },
            { label: "Labs & results", href: "/patient/labs", icon: "labs" },
            { label: "Prevention", href: "/patient/prevention", icon: "preventive" },
            { label: "Health Check", href: "/patient/health-check", icon: "review" },
            { label: "Get a device", href: "/patient/devices", icon: "devices" },
          ],
        },
        {
          label: "Stay well",
          groupHref: "/patient/stay-well",
          items: [
            { label: "Lifestyle coaching", href: "/patient/lifestyle", icon: "lifestyle" },
            { label: "Weight management", href: "/patient/weight-management", icon: "weight" },
            { label: "Food & meals", href: "/patient/nutrition", icon: "nutrition" },
            { label: "Movement", href: "/patient/activity", icon: "steps" },
            { label: "Learn", href: "/patient/learn", icon: "learn" },
            { label: "Wellness rewards", href: "/patient/wellness", icon: "wellness" },
          ],
        },
        {
          label: "Support",
          groupHref: "/patient/support",
          items: [
            {
              label: "Messages",
              href: "/patient/messages",
              icon: "messages",
              primary: true,
              shortLabel: "Messages",
            },
            { label: "Care & support", href: "/patient/care", icon: "clinicianFollowUp" },
            { label: "Appointments", href: "/patient/appointments", icon: "booking" },
            { label: "Family", href: "/patient/family", icon: "family" },
            { label: "People you support", href: "/patient/supporting", icon: "parentCare" },
          ],
        },
        {
          label: "Your account",
          groupHref: "/patient/account",
          items: [
            { label: "Health Passport", href: "/patient/health-passport", icon: "passport" },
            { label: "Subscription", href: "/patient/subscription", icon: "billing" },
            { label: "Profile", href: "/patient/profile", icon: "settings" },
            { label: "Privacy & data", href: "/patient/privacy", icon: "privacy" },
          ],
        },
        {
          // Never inside a collapsed group. Safety-critical, and a patient
          // reaching for it is not browsing.
          items: [
            {
              label: "Emergency card",
              href: "/patient/emergency-card",
              icon: "warning",
              variant: "danger",
            },
          ],
        },
      ];
    case "clinician":
    case "care_coordinator":
      // Care Coordinators share the clinician surfaces they can act on
      // (logistics-only work: orders, bookings, inboxes, the patient
      // directory, patient messaging, and raising — never claiming or
      // resolving — an escalation); clinical judgment pages/actions self-gate
      // server-side via isClinicalTier (lib/clinical/doctor-tier.ts), which
      // is what keeps Patients/Escalations safe to link here even though a
      // Care Coordinator carries an active clinical_staff row. The old
      // separate "Outreach" link now lives inside the Dashboard's own tabs
      // (Overview / Outreach worklist / Follow-ups / Contact log — see
      // dashboard/care-coordinator/layout.tsx) instead of duplicating that
      // worklist as its own top-level page.
      return role === "care_coordinator"
        ? [
            {
              items: [
                {
                  label: "Dashboard",
                  href: "/dashboard/care-coordinator",
                  icon: "dashboard",
                  exact: true,
                },
                { label: "Patients", href: "/clinician/patients", icon: "parentCare" },
                { label: "Patient messages", href: "/clinician/messages", icon: "messages" },
                { label: "Escalations", href: "/clinician/escalations", icon: "escalation" },
                {
                  label: "Medication issues",
                  href: "/clinician/medication-issues",
                  icon: "medication",
                },
                { label: "Orders", href: "/clinician/orders", icon: "logistics" },
                { label: "Support inbox", href: "/clinician/support-inbox", icon: "inbox" },
                {
                  label: "Safety incidents",
                  href: "/clinician/safety-incidents",
                  icon: "warning",
                },
              ],
            },
          ]
        : [
            {
              items: [{ label: "Dashboard", href: "/clinician", icon: "dashboard", exact: true }],
            },
            {
              // Inboxes — anything a patient or a colleague is waiting on a
              // reply to.
              label: "Queue",
              items: [
                { label: "Escalations", href: "/clinician/escalations", icon: "escalation" },
                {
                  label: "Medication issues",
                  href: "/clinician/medication-issues",
                  icon: "medication",
                },
                { label: "Results inbox", href: "/clinician/results-inbox", icon: "labs" },
                { label: "Support inbox", href: "/clinician/support-inbox", icon: "inbox" },
                { label: "Patient messages", href: "/clinician/messages", icon: "messages" },
              ],
            },
            {
              label: "Patients & Care",
              items: [
                { label: "Patients", href: "/clinician/patients", icon: "parentCare" },
                { label: "Care plan review", href: "/clinician/care-plan-review", icon: "carePlan" },
                { label: "Medication reviews", href: "/clinician/medication-reviews", icon: "medication" },
                { label: "Lifestyle reviews", href: "/clinician/lifestyle-reviews", icon: "lifestyle" },
                { label: "Lifestyle flags", href: "/clinician/lifestyle-flags", icon: "lifestyle" },
                { label: "Annual reviews", href: "/clinician/annual-reviews", icon: "review" },
                { label: "Preventive reviews", href: "/clinician/preventive-reviews", icon: "preventive" },
              ],
            },
            {
              label: "Orders & Referrals",
              items: [
                { label: "Referrals", href: "/clinician/referrals", icon: "referral" },
                { label: "Orders", href: "/clinician/orders", icon: "logistics" },
                { label: "Vaccinations", href: "/clinician/vaccinations", icon: "vaccination" },
              ],
            },
            {
              label: "Quality & Growth",
              items: [
                { label: "Diabetes quality", href: "/clinician/diabetes-quality", icon: "diabetes" },
                { label: "Hypertension quality", href: "/clinician/hypertension-quality", icon: "bp" },
                { label: "Obesity quality", href: "/clinician/obesity-quality", icon: "weight" },
                {
                  label: "Quality improvement",
                  href: "/clinician/quality-improvement",
                  icon: "review",
                },
                { label: "Safety incidents", href: "/clinician/safety-incidents", icon: "warning" },
                { label: "Adherence alerts", href: "/clinician/adherence", icon: "medication" },
                { label: "Outreach", href: "/clinician/outreach", icon: "messages" },
                { label: "Recommendations", href: "/clinician/recommendations", icon: "carePlan" },
              ],
            },
            {
              label: "My work",
              items: [
                { label: "Availability", href: "/clinician/availability", icon: "booking" },
                { label: "Appointments", href: "/clinician/appointments", icon: "booking" },
                { label: "Async consults", href: "/clinician/async-consults", icon: "inbox" },
                { label: "My performance", href: "/clinician/my-performance", icon: "analytics" },
              ],
            },
          ];
    case "admin":
      return [
        {
          items: [
            { label: "Dashboard", href: "/admin", icon: "dashboard", exact: true },
            { label: "Analytics", href: "/analytics", icon: "analytics" },
          ],
        },
        {
          label: "Operations",
          items: [
            { label: "Members & access", href: "/admin/settings/members", icon: "members" },
            { label: "Clinical staff", href: "/admin/settings/clinical-staff", icon: "clinicianFollowUp" },
            { label: "Partners", href: "/admin/settings/partners", icon: "corporate" },
            { label: "Facilities", href: "/admin/facilities", icon: "hmo" },
            { label: "Bookings", href: "/admin/bookings", icon: "booking" },
            { label: "Service regions", href: "/admin/settings/service-regions", icon: "region" },
            { label: "Company & legal profile", href: "/admin/settings/company-profile", icon: "corporate" },
          ],
        },
        {
          label: "Commercial",
          items: [
            { label: "Subscriptions", href: "/admin/settings/subscriptions", icon: "billing" },
            { label: "Commissions", href: "/admin/settings/commissions", icon: "commission" },
            { label: "Broadcasts", href: "/admin/settings/broadcasts", icon: "broadcast" },
            { label: "Resources hub", href: "/admin/settings/resources", icon: "messages" },
            { label: "Wellness rewards", href: "/admin/settings/wellness", icon: "wellness" },
            { label: "Care vouchers", href: "/admin/settings/vouchers", icon: "payables" },
            { label: "Data breach incidents", href: "/admin/settings/data-breach-incidents", icon: "reconcile" },
          ],
        },
        {
          label: "Clinical",
          items: [
            { label: "Doctor caseload", href: "/admin/staffing/caseload", icon: "caseload" },
            { label: "Vaccination schedule", href: "/admin/settings/vaccination-schedule", icon: "vaccination" },
            { label: "Escalation SLAs", href: "/admin/settings/escalation-slas", icon: "escalation" },
            { label: "CV-risk (cholesterol) config", href: "/admin/settings/cv-risk-config", icon: "bp" },
          ],
        },
      ];
    case "pharmacist":
      return [
        {
          items: [
            { label: "Overview", href: "/pharmacist", icon: "dashboard", exact: true },
            { label: "Orders", href: "/pharmacist/orders", icon: "pharmacy" },
            { label: "Dispensing history", href: "/pharmacist/history", icon: "audit" },
            { label: "Pharmacy profile", href: "/pharmacist/profile", icon: "settings" },
          ],
        },
      ];
    case "lab_partner":
      return [
        {
          items: [
            { label: "Dashboard", href: "/lab-partner", icon: "dashboard", exact: true },
          ],
        },
      ];
    case "lab_liaison":
      return [
        {
          items: [
            { label: "Dashboard", href: "/lab-liaison", icon: "dashboard", exact: true },
          ],
        },
      ];
    case "analyst":
      // Full grouped category nav (Financial/People/Growth/Operations/
      // Governance) matching the "Tarragon Health Analyst Dashboard" design —
      // this is the analyst's entire surface, so the sidebar carries all 16
      // categories rather than the single-link + in-page pill-tab pattern
      // admin (who has this console plus everything else) still uses. Built
      // from lib/analytics/sections.ts, the shared source of truth also used
      // by the per-page header and the Overview page's quick-link cards.
      return [
        {
          items: [{ label: "Overview", href: "/analytics", icon: "dashboard", exact: true }],
        },
        ...ANALYTICS_GROUP_ORDER.map((group) => ({
          label: group,
          items: ANALYTICS_SECTIONS.filter((s) => s.group === group).map((s) => ({
            label: s.label,
            href: s.href,
            icon: s.icon,
          })),
        })),
      ];
    case "finance":
      return [
        {
          items: [
            { label: "Overview", href: "/finance", icon: "dashboard", exact: true },
            { label: "General ledger", href: "/finance/ledger", icon: "ledger" },
            { label: "Financial statements", href: "/finance/statements", icon: "statements" },
            { label: "Budgets", href: "/finance/budgets", icon: "budget" },
            { label: "Payables & vendors", href: "/finance/payables", icon: "payables" },
            { label: "Revenue recognition", href: "/finance/revenue", icon: "billing" },
            { label: "Reconciliation", href: "/finance/reconciliation", icon: "reconcile" },
            { label: "Tax", href: "/finance/tax", icon: "tax" },
            { label: "Compliance calendar", href: "/finance/compliance", icon: "compliance" },
            { label: "Reports & filings", href: "/finance/reports", icon: "statements" },
          ],
        },
        {
          label: "Controls",
          items: [
            { label: "Approvals", href: "/finance/approvals", icon: "approvals" },
            { label: "Audit log", href: "/finance/audit", icon: "audit" },
          ],
        },
        {
          label: "Setup",
          items: [
            { label: "Periods & accounts", href: "/finance/settings", icon: "settings" },
          ],
        },
      ];
    case "corporate_admin":
      return [
        {
          items: [
            { label: "Dashboard", href: "/dashboard/corporate", icon: "dashboard", exact: true },
          ],
        },
      ];
    case "hmo_admin":
      return [
        {
          items: [
            { label: "Dashboard", href: "/dashboard/hmo", icon: "dashboard", exact: true },
          ],
        },
      ];
    default:
      return [];
  }
}

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
}

/** A labelled group of sidebar links. `label` is omitted for the top group. */
export interface NavSection {
  label?: string;
  items: NavItem[];
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
              { label: "People you support", href: "/patient/supporting", icon: "parentCare" },
              { label: "Messages", href: "/patient/messages", icon: "messages" },
              { label: "Your people", href: "/patient/family", icon: "family" },
              // Not "Subscription" — a supporter has no plan of their own. This
              // is where they see what they are paying for other people.
              { label: "Payments", href: "/patient/subscription", icon: "billing" },
            ],
          },
        ];
      }
      // Flat, single-level menu (2026-08-09 dashboard redesign) — replaces the
      // old split between this sidebar and the second-level PatientNav pill-tab
      // bar that used to live only inside /patient itself. Vitals, Medications,
      // Labs, Care & support and Profile are promoted here so every section is
      // one click away, matching the "Tarragon Health Web Dashboard" design.
      // Health Check and Lifestyle coaching are deliberately not top-level
      // entries any more — both stay reachable inline from Prevention/Care
      // (Prevention already links to Health Check; Care and several
      // lifestyle-adjacent pages already link to Lifestyle coaching), matching
      // how the design itself surfaces "Resume Health Check" as a button
      // inside a page rather than as its own sidebar slot.
      return [
        {
          items: [
            { label: "Overview", href: "/patient", icon: "dashboard", exact: true },
            { label: "Vitals & symptoms", href: "/patient/vitals", icon: "bp" },
            { label: "Medications", href: "/patient/medications", icon: "medication" },
            { label: "Prevention", href: "/patient/prevention", icon: "preventive" },
            { label: "Care & support", href: "/patient/care", icon: "clinicianFollowUp" },
            { label: "Family", href: "/patient/family", icon: "family" },
            { label: "Health Passport", href: "/patient/health-passport", icon: "passport" },
            { label: "Labs", href: "/patient/labs", icon: "labs" },
            { label: "Wellness", href: "/patient/wellness", icon: "wellness" },
            { label: "Messages", href: "/patient/messages", icon: "messages" },
            { label: "Subscription", href: "/patient/subscription", icon: "billing" },
            { label: "Profile", href: "/patient/profile", icon: "settings" },
            // Real feature the design's own single-persona mock doesn't happen
            // to show (that patient supports nobody) — kept reachable rather
            // than regressed, just moved off the mock's primary 12 to match
            // its ordering as closely as possible.
            { label: "People you support", href: "/patient/supporting", icon: "parentCare" },
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
      // (logistics-only work: orders, bookings, inboxes); clinical judgment
      // pages self-gate server-side. The old separate "Outreach" link now
      // lives inside the Dashboard's own tabs (Overview / Outreach worklist /
      // Follow-ups / Contact log — see dashboard/care-coordinator/layout.tsx)
      // instead of duplicating that worklist as its own top-level page.
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
                { label: "Orders", href: "/clinician/orders", icon: "logistics" },
                { label: "Support inbox", href: "/clinician/support-inbox", icon: "inbox" },
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
                { label: "Adherence alerts", href: "/clinician/adherence", icon: "medication" },
                { label: "Outreach", href: "/clinician/outreach", icon: "messages" },
                { label: "Recommendations", href: "/clinician/recommendations", icon: "carePlan" },
              ],
            },
            {
              label: "My work",
              items: [
                { label: "Availability", href: "/clinician/availability", icon: "booking" },
                { label: "Async consults", href: "/clinician/async-consults", icon: "inbox" },
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

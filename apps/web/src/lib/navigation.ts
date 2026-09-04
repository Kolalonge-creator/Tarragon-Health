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
              // A supporter's money is not always aimed at one linked person —
              // a diaspora hometown association funding a village screening day
              // is the same "I pay, they receive" shape as People you support,
              // just for a group instead of one named relative.
              // Deliberately NOT `primary` — the four items above already fill
              // MAX_PRIMARY_NAV_ITEMS, so a fifth flag would silently never
              // reach the phone bottom bar; this stays behind the More button.
              {
                label: "Group screening days",
                href: "/patient/screening-days",
                icon: "booking",
                shortLabel: "Screening",
              },
            ],
          },
        ];
      }
      // Grouped into four labelled bands (2026-08-12 patient-navigation pass),
      // replacing the flat single-level list of the 2026-08-09 redesign. The
      // flat list was right to promote every section out of the old
      // second-level PatientNav pill bar, but it kept growing: fifteen
      // equally-weighted links with no headings is past the point where a
      // patient scans rather than reads, and "Wellness" sat two rows from
      // "My services" with nothing to say they belong to different parts of
      // their life. Nothing is hidden or demoted — the same links, banded by
      // the question each one answers:
      //   (top)        where am I / what needs me today
      //   Your health  the clinical record they log into and read back
      //   Stay well    the things that keep a well person well
      //   Support      the humans: care team, messages, family
      //   Your account admin they touch a few times a year
      // Two real pages that were previously reachable only through an inline
      // link from another page are now listed: Lifestyle coaching
      // (/patient/lifestyle, the hub the nutrition/weight/activity trackers
      // all link "back" to, which nothing in the sidebar ever pointed at) and
      // Health Check (/patient/health-check). Both were being missed, which
      // is the same failure the Learn tab had before it was promoted.
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
            // Spec §76.5 ("action centre") — every outstanding task in one
            // urgency-bucketed place, not scattered across Overview's
            // individual cards. First-class nav entry, not just a link off
            // Overview, since it's meant to be reachable directly.
            { label: "My actions", href: "/patient/actions", icon: "approvals" },
          ],
        },
        {
          label: "Your health",
          items: [
            // Spec §76.3 ("personal health summary") — conditions,
            // allergies, medications, measurements, investigations, care
            // programmes, appointments, referrals and preventive tasks in
            // one place, composed from the record the sections below already
            // hold rather than a second copy of it.
            { label: "Health summary", href: "/patient/health-summary", icon: "carePlan" },
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
            { label: "Women's Health", href: "/patient/womens-health", icon: "family" },
            {
              label: "Sexual & reproductive health",
              href: "/patient/sexual-health",
              icon: "family",
            },
            { label: "Wellbeing", href: "/patient/wellbeing", icon: "mood" },
            { label: "Health Check", href: "/patient/health-check", icon: "review" },
            { label: "Adolescent Health", href: "/patient/adolescent-health", icon: "mood" },
            { label: "Find a specialist", href: "/patient/find-a-specialist", icon: "referral" },
            { label: "Healthy ageing", href: "/patient/healthy-ageing", icon: "healthyAgeing" },
            { label: "Get a device", href: "/patient/devices", icon: "devices" },
          ],
        },
        {
          label: "Stay well",
          items: [
            { label: "Lifestyle coaching", href: "/patient/lifestyle", icon: "lifestyle" },
            { label: "Weight management", href: "/patient/weight-management", icon: "weight" },
            { label: "Learn", href: "/patient/learn", icon: "learn" },
            { label: "Wellness rewards", href: "/patient/wellness", icon: "wellness" },
          ],
        },
        {
          label: "Support",
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
            // Real feature a single-persona mock doesn't happen to show (that
            // patient supports nobody) — kept reachable rather than regressed.
            { label: "People you support", href: "/patient/supporting", icon: "parentCare" },
            { label: "Group screening days", href: "/patient/screening-days", icon: "booking" },
          ],
        },
        {
          label: "Your account",
          items: [
            { label: "Health Passport", href: "/patient/health-passport", icon: "passport" },
            { label: "Your finances", href: "/patient/financial-profile", icon: "payables" },
            { label: "Insurance", href: "/patient/insurance", icon: "insurance" },
            { label: "My services", href: "/patient/subscription", icon: "billing" },
            { label: "Receipts", href: "/patient/receipts", icon: "receipts" },
            {
              label: "Notification settings",
              href: "/patient/notification-settings",
              icon: "bell",
            },
            // Patient Support & Service Centre (spec §24), narrowed to
            // technical/app issues and formal complaints — appointment,
            // pharmacy, laboratory, insurance, referral, and payment help
            // is the "Need help" card on Care & support (navigation_requests,
            // module 75) instead. See the support_tickets_category_technical_only
            // migration for the full reconciliation.
            { label: "Technical support", href: "/patient/support", icon: "helpCenter" },
            { label: "Profile", href: "/patient/profile", icon: "settings" },
            { label: "Privacy & data", href: "/patient/privacy", icon: "privacy" },
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
                { label: "Case management", href: "/clinician/case-management", icon: "carePlan" },
                { label: "Safeguarding", href: "/clinician/safeguarding", icon: "warning" },
                {
                  label: "Operations queue",
                  href: "/clinician/operations-queue",
                  icon: "escalation",
                },
                {
                  label: "Medication issues",
                  href: "/clinician/medication-issues",
                  icon: "medication",
                },
                { label: "Orders", href: "/clinician/orders", icon: "logistics" },
                { label: "Support inbox", href: "/clinician/support-inbox", icon: "inbox" },
                { label: "Support tickets", href: "/clinician/support-tickets", icon: "helpCenter" },
                { label: "Complaints", href: "/clinician/complaints", icon: "governance" },
                {
                  label: "Safety incidents",
                  href: "/clinician/safety-incidents",
                  icon: "warning",
                },
              ],
            },
            // Only reachable for a Coordinator holding a delegated
            // ops.console.view/incidents.* grant (e.g. the "Customer support
            // administrator" or "Provider network administrator" role
            // presets) — the pages self-gate, so this link is always safe to
            // show, same pattern as every other admin-area nav entry.
            {
              label: "Operations",
              items: [
                { label: "Operations console", href: "/admin/ops", icon: "operations" },
                { label: "Incident register", href: "/admin/ops/incidents", icon: "siren" },
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
                { label: "Safeguarding", href: "/clinician/safeguarding", icon: "warning" },
                {
                  label: "Operations queue",
                  href: "/clinician/operations-queue",
                  icon: "escalation",
                },
                {
                  label: "Medication issues",
                  href: "/clinician/medication-issues",
                  icon: "medication",
                },
                { label: "Results inbox", href: "/clinician/results-inbox", icon: "labs" },
                { label: "Support inbox", href: "/clinician/support-inbox", icon: "inbox" },
                { label: "Support tickets", href: "/clinician/support-tickets", icon: "helpCenter" },
                { label: "Complaints", href: "/clinician/complaints", icon: "governance" },
                { label: "Patient messages", href: "/clinician/messages", icon: "messages" },
              ],
            },
            {
              label: "Patients & Care",
              items: [
                { label: "Patients", href: "/clinician/patients", icon: "parentCare" },
                { label: "Case management", href: "/clinician/case-management", icon: "carePlan" },
                { label: "Care plan review", href: "/clinician/care-plan-review", icon: "carePlan" },
                { label: "Medication reviews", href: "/clinician/medication-reviews", icon: "medication" },
                { label: "Lifestyle reviews", href: "/clinician/lifestyle-reviews", icon: "lifestyle" },
                { label: "Lifestyle flags", href: "/clinician/lifestyle-flags", icon: "lifestyle" },
                { label: "Annual reviews", href: "/clinician/annual-reviews", icon: "review" },
                { label: "Preventive reviews", href: "/clinician/preventive-reviews", icon: "preventive" },
                { label: "Sexual health cases", href: "/clinician/sexual-health", icon: "escalation" },
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
                { label: "Device operations", href: "/clinician/device-operations", icon: "devices" },
                { label: "Data deletion requests", href: "/clinician/data-deletion-requests", icon: "compliance" },
              ],
            },
            {
              label: "My work",
              items: [
                { label: "Availability", href: "/clinician/availability", icon: "booking" },
                { label: "Appointments", href: "/clinician/appointments", icon: "booking" },
                { label: "Async consults", href: "/clinician/async-consults", icon: "inbox" },
                {
                  label: "Lab result consults",
                  href: "/clinician/lab-result-consults",
                  icon: "labs",
                },
                { label: "My performance", href: "/clinician/my-performance", icon: "analytics" },
              ],
            },
            // Only reachable for a clinician holding a delegated
            // ops.console.view/incidents.* grant (the "Clinical
            // administrator" role preset) — self-gated, safe to always show.
            {
              label: "Operations administration",
              items: [
                { label: "Operations console", href: "/admin/ops", icon: "operations" },
                { label: "Incident register", href: "/admin/ops/incidents", icon: "siren" },
              ],
            },
          ];
    case "admin":
      // Every settings-shaped page (members, partners, protocols, billing,
      // compliance, ...) used to be its own sidebar link across these
      // groups — ~15 of them, plus another ~13 reachable only from the
      // /admin home page's tile grid. They now live behind the single
      // "Settings" entry below, whose top tab bar
      // (admin/settings/layout.tsx) groups all ~28 into 7 sections. Only
      // genuinely operational pages (live data to work, not configuration)
      // stay as direct sidebar links.
      return [
        {
          items: [
            { label: "Dashboard", href: "/admin", icon: "dashboard", exact: true },
            { label: "Operations console", href: "/admin/ops", icon: "operations" },
            { label: "Analytics", href: "/analytics", icon: "analytics" },
          ],
        },
        {
          label: "Operations",
          items: [
            { label: "Facilities", href: "/admin/facilities", icon: "hmo" },
            { label: "Bookings", href: "/admin/bookings", icon: "booking" },
            { label: "Doctor caseload", href: "/admin/staffing/caseload", icon: "caseload" },
            { label: "Incident register", href: "/admin/ops/incidents", icon: "siren" },
            { label: "Employers", href: "/admin/employers", icon: "corporate" },
            { label: "Leads", href: "/admin/leads", icon: "members" },
            { label: "Promo codes", href: "/admin/promo-codes", icon: "billing" },
            { label: "Provider quality", href: "/admin/provider-quality", icon: "governance" },
            { label: "Testimonials", href: "/admin/testimonials", icon: "review" },
          ],
        },
        {
          label: "Configuration",
          items: [{ label: "Settings", href: "/admin/settings", icon: "settings" }],
        },
      ];
    case "pharmacist":
      return [
        {
          items: [
            { label: "Overview", href: "/pharmacist", icon: "dashboard", exact: true },
            { label: "Orders", href: "/pharmacist/orders", icon: "pharmacy" },
            { label: "Verify a prescription", href: "/pharmacist/verify", icon: "approvals" },
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
        // Only reachable for an analyst-based account holding a delegated
        // grant (the "Technical administrator" or "Data & analytics
        // administrator" role presets carry ops.console.view/incidents.*;
        // only Technical administrator carries feature_flags.manage) —
        // self-gated, safe to always show.
        {
          label: "Platform operations",
          items: [
            { label: "Operations console", href: "/admin/ops", icon: "operations" },
            { label: "Incident register", href: "/admin/ops/incidents", icon: "siren" },
            { label: "Feature flags", href: "/admin/settings/feature-flags", icon: "flag" },
          ],
        },
      ];
    case "finance":
      return [
        {
          items: [
            { label: "Overview", href: "/finance", icon: "dashboard", exact: true },
            { label: "General ledger", href: "/finance/ledger", icon: "ledger" },
            { label: "Transactions", href: "/finance/transactions", icon: "billing" },
            { label: "Financial statements", href: "/finance/statements", icon: "statements" },
            { label: "Budgets", href: "/finance/budgets", icon: "budget" },
            { label: "Payables & vendors", href: "/finance/payables", icon: "payables" },
            { label: "Employer billing", href: "/finance/employer-billing", icon: "billing" },
            { label: "Revenue recognition", href: "/finance/revenue", icon: "billing" },
            { label: "Reconciliation", href: "/finance/reconciliation", icon: "reconcile" },
            { label: "Fraud signals", href: "/finance/fraud", icon: "warning" },
            { label: "Laboratory settlements", href: "/finance/partner-settlements", icon: "payables" },
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
        // Only reachable for a Finance administrator holding the delegated
        // ops.console.view/incidents.* grant — self-gated, safe to show.
        {
          label: "Operations",
          items: [
            { label: "Operations console", href: "/admin/ops", icon: "operations" },
            { label: "Incident register", href: "/admin/ops/incidents", icon: "siren" },
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
    // Module 27 — built dormant (platform_modules.payer_platform, off by
    // default). Every page under /payer itself checks module + seat
    // membership server-side and renders a "not yet activated" placeholder
    // when either is missing, so this nav entry is always safe to render.
    case "payer_admin":
      return [
        {
          items: [
            { label: "Overview", href: "/payer", icon: "dashboard", exact: true },
          ],
        },
        {
          label: "Product",
          items: [
            { label: "Plans", href: "/payer/plans", icon: "billing" },
            { label: "Provider network", href: "/payer/network", icon: "hmo" },
            { label: "Care programmes", href: "/payer/programmes", icon: "carePlan" },
          ],
        },
        {
          label: "Operations",
          items: [
            { label: "Pre-authorisations", href: "/payer/preauthorizations", icon: "approvals" },
            { label: "Claims", href: "/payer/claims", icon: "ledger" },
          ],
        },
        {
          label: "Setup",
          items: [
            { label: "Team", href: "/payer/team", icon: "members" },
          ],
        },
      ];
    // Module 28 — built dormant (platform_modules.provider_org_platform, off
    // by default). Same posture as the payer nav above: every /provider-org
    // page checks module + org is_operational + seat membership itself.
    case "provider_org_staff":
      return [
        {
          items: [
            { label: "Overview", href: "/provider-org", icon: "dashboard", exact: true },
          ],
        },
        {
          label: "Organisation",
          items: [
            { label: "Locations", href: "/provider-org/locations", icon: "region" },
            { label: "Staff", href: "/provider-org/staff", icon: "members" },
            { label: "Services", href: "/provider-org/services", icon: "carePlan" },
            { label: "Resources", href: "/provider-org/resources", icon: "settings" },
          ],
        },
        {
          label: "Queues",
          items: [
            { label: "Referrals", href: "/provider-org/referrals", icon: "referral" },
            { label: "Lab orders", href: "/provider-org/lab-orders", icon: "labs" },
            { label: "Pharmacy orders", href: "/provider-org/pharmacy-orders", icon: "pharmacy" },
          ],
        },
        {
          label: "Finance",
          items: [
            { label: "Settlements", href: "/provider-org/settlements", icon: "statements" },
          ],
        },
      ];
    default:
      return [];
  }
}

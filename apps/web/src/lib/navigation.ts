import { t } from "@tarragon/i18n";
import type { AppIconName } from "@/lib/icons";
import { ANALYTICS_GROUP_ORDER, ANALYTICS_SECTIONS } from "@/lib/analytics/sections";
import type { WorklistCountKey } from "@/lib/queries/worklist-counts";

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
  /** Position among the phone tabs when the tabs come from different groups (the patient's Home, My Health, Messages, Care plan:
   * PD-01). Lower first; flagged items without it follow in declaration order. See primaryNavItems. */
  primaryOrder?: number;
  /** Puts this link behind the group's "More in this group" toggle in the sidebar, so a long group stays scannable. It stays in
   * search, and the toggle opens on its own when the current page is one of these links. */
  more?: boolean;
  /** Short label for the bottom tab bar, where a full label like
   * "Vitals & symptoms" cannot fit. Falls back to `label`. */
  shortLabel?: string;
  /** Ties this link to a live open-item count (see lib/queries/worklist-counts)
   * so AppShell can render a small badge next to it — the same "what's
   * actually waiting for me" number a doctor used to have to return to the
   * dashboard to see, now visible from every page. Badge is hidden at zero
   * rather than shown greyed-out: a persistent sidebar repeats on every
   * screen, so a wall of "0" pills would be louder than the dashboard's own
   * zero-state tiles ever were. A failed underlying query never renders as a
   * hidden (zero-looking) badge — see NavBadge in app-shell.tsx. */
  countKey?: WorklistCountKey;
  /** Other pages this link stands in for: the link is shown as active on them too. The Governance index uses it
   * so a page reached from that index still lights its sidebar entry and keeps its group open (DW-02). */
  alsoActiveFor?: readonly string[];
  /** Phone bottom bar only: other pages on which this tab shows as active (PD-01: vitals, medicines and results sit inside
   * My Health). Unlike `alsoActiveFor` it does not light the sidebar entry, where those pages have links of their own. */
  tabAlsoActiveFor?: readonly string[];
}

/** How many `primary` links the phone bottom bar shows before the More
 * button. Four plus More keeps every target above the ~44px tap-target floor
 * on a 320px-wide screen. */
export const MAX_PRIMARY_NAV_ITEMS = 4;

/** The links the phone bottom bar shows: the `primary` ones, ordered by `primaryOrder` (then declaration order), capped at
 * MAX_PRIMARY_NAV_ITEMS. */
export function primaryNavItems(sections: readonly NavSection[]): NavItem[] {
  return sections
    .flatMap((s) => s.items)
    .filter((item) => item.primary)
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.primaryOrder ?? Number.MAX_SAFE_INTEGER) - (b.item.primaryOrder ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
    .slice(0, MAX_PRIMARY_NAV_ITEMS)
    .map(({ item }) => item);
}

/** A labelled group of sidebar links. `label` is omitted for the top group. */
export interface NavSection {
  label?: string;
  /** The group's icon in the icon-only collapsed sidebar (the admin console's rail). Unused elsewhere. */
  icon?: AppIconName;
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
  /**
   * Community groups are dormant behind the `community` go-live guard (docs/COMMUNITY_SPEC.md section 8). The entry is added only when
   * the database says the community is open for this member, so while it is closed nothing about it shows anywhere in the menu.
   */
  options?: {
    communityOpen?: boolean;
    /** An active Chief Medical Officer: the Clinical Leadership Overview leads their menu (CMO command centre, 2026-11-07). */
    cmo?: boolean;
  },
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
      // Six groups (patient dashboard 2.0, slice C; docs/design/PATIENT-DASHBOARD-2.md section 4 and PD-01). The menu had grown to 43
      // links in five bands with four overlapping doors to one record (Health summary, My Health, My Health Records, Health Passport).
      // Each group now answers one question:
      //   (Home)       where am I / what needs me today. Unlabelled, so it is never collapsed.
      //   My health    my record and the things I log and take, plus the condition and life-stage pages
      //   Healthcare   tests, results, visits and the services I can book
      //   My support   the people: care team messages, family, community
      //   Resources    reading, rewards and help
      //   Account      my details, membership, money, privacy; the Emergency card stays pinned (see AppShell)
      // Nothing is deleted. The three record pages that left the menu (Health summary, My Health Records, Health Passport) are one tap
      // from the "My health record" hub (/patient/my-health) and stay in search (PATIENT_EXTRA_PAGES in lib/patient-search.ts); a
      // test (patient-menu-coverage.test.ts) proves every page in the old menu is still in the menu or in search.
      // `more: true` links sit behind a "More in this group" toggle so a long group stays scannable.
      // Phone tabs (PD-01): Home, My Health, Messages, Care plan, then More. `primaryOrder` fixes that order across groups.
      return [
        {
          items: [
            {
              label: "Overview",
              href: "/patient",
              icon: "dashboard",
              exact: true,
              primary: true,
              primaryOrder: 1,
              shortLabel: "Home",
            },
            // Spec §76.5 ("action centre"): every outstanding task in one urgency-bucketed place.
            { label: "My actions", href: "/patient/actions", icon: "approvals" },
          ],
        },
        {
          label: "My health",
          items: [
            // The one door to the record: timeline, documents, passport, emergency card, shares, who has looked, and links to the
            // health summary and every report. Replaces four menu entries.
            {
              label: "My health record",
              href: "/patient/my-health",
              icon: "passport",
              primary: true,
              primaryOrder: 2,
              shortLabel: "My Health",
              // PD-01: vitals, medicines and results sit inside My Health on the phone, so the tab stays lit on those pages.
              tabAlsoActiveFor: [
                "/patient/vitals",
                "/patient/medications",
                "/patient/labs",
                "/patient/timeline",
                "/patient/health-summary",
                "/patient/health-records",
              ],
            },
            { label: "Vitals & symptoms", href: "/patient/vitals", icon: "bp" },
            { label: "Medications", href: "/patient/medications", icon: "medication" },
            // The care plan lives on Care & support (my-care-plan-tasks.tsx), together with the "Need help" card and paid services. The
            // menu keeps the page's own name (onboarding copy points to it); the phone tab says "Care plan" (PD-01).
            {
              label: "Care & support",
              href: "/patient/care",
              icon: "clinicianFollowUp",
              primary: true,
              primaryOrder: 4,
              shortLabel: "Care plan",
            },
            { label: "Your care pathway", href: "/patient/pathway", icon: "carePlan" },
            { label: "Programmes", href: "/patient/programmes", icon: "members" },
            { label: "Health Check", href: "/patient/health-check", icon: "review" },
            { label: "Prevention", href: "/patient/prevention", icon: "preventive" },
            // Condition and life-stage pages. Women's Health is already hidden for a recorded male (the page-gate rule in the
            // dashboard layout), so the group only shows what applies.
            { label: "Women's Health", href: "/patient/womens-health", icon: "family", more: true },
            { label: "Sexual & reproductive health", href: "/patient/sexual-health", icon: "family", more: true },
            { label: "Wellbeing", href: "/patient/wellbeing", icon: "mood", more: true },
            { label: "Self-help programmes", href: "/patient/self-help", icon: "mood", more: true },
            { label: "Healthy ageing", href: "/patient/healthy-ageing", icon: "healthyAgeing", more: true },
            { label: "Lifestyle coaching", href: "/patient/lifestyle", icon: "lifestyle", more: true },
            { label: "Weight management", href: "/patient/weight-management", icon: "weight", more: true },
          ],
        },
        {
          label: "Healthcare",
          items: [
            { label: "Labs & results", href: "/patient/labs", icon: "labs" },
            { label: "Appointments", href: "/patient/appointments", icon: "booking" },
            // The year at a glance: consultations, testing-day places already held and screenings due.
            { label: "My calendar", href: "/patient/calendar", icon: "booking" },
            { label: "Find a specialist", href: "/patient/find-a-specialist", icon: "referral" },
            // The one-off service catalogue (video visits, Ask a doctor, second opinions, verified documents). The route name
            // "subscription" predates the pay-per-service pivot.
            { label: "My services", href: "/patient/subscription", icon: "billing" },
            { label: "Group screening days", href: "/patient/screening-days", icon: "booking" },
            // T2-02: testing days take no new bookings; this page now shows places already held and their results.
            { label: "Testing days", href: "/patient/testing-days", icon: "booking" },
          ],
        },
        {
          label: "My support",
          items: [
            {
              label: "Messages",
              href: "/patient/messages",
              icon: "messages",
              primary: true,
              primaryOrder: 3,
              shortLabel: "Messages",
            },
            { label: "Family", href: "/patient/family", icon: "family" },
            ...(options?.communityOpen ? [{ label: t("community.nav.title"), href: "/patient/community", icon: "family" as const }] : []),
            // Real feature a single-persona mock doesn't happen to show (that patient supports nobody), kept reachable.
            { label: "People you support", href: "/patient/supporting", icon: "parentCare" },
            { label: "Yearly reports for people you support", href: "/patient/family/health-reports", icon: "passport" },
            { label: "Notification settings", href: "/patient/notification-settings", icon: "bell" },
          ],
        },
        {
          label: "Resources",
          items: [
            { label: "Learn", href: "/patient/learn", icon: "learn" },
            { label: "Wellness rewards", href: "/patient/wellness", icon: "wellness" },
            // Technical/app issues and formal complaints (spec §24); help with a booking, a lab or a payment is the "Need help"
            // card on Care & support instead.
            { label: "Technical support", href: "/patient/support", icon: "helpCenter" },
          ],
        },
        {
          label: "Account",
          items: [
            { label: "Profile", href: "/patient/profile", icon: "settings" },
            // Buy the Membership or a care pack, see what is included and the price, and see your payments (S25).
            { label: "Membership", href: "/patient/membership", icon: "billing" },
            { label: "Your finances", href: "/patient/financial-profile", icon: "payables" },
            { label: "Get a device", href: "/patient/devices", icon: "devices" },
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
                // MSG-5: what is waiting across messages, alerts and monthly meetings, and who holds it. Any staff member.
                { label: "Care operations", href: "/dashboard/care-coordinator/operations", icon: "operations" },
                { label: "Escalations", href: "/clinician/escalations", icon: "escalation" },
                // Case management, Safeguarding, Operations queue and
                // Medication issues were listed here but are not in
                // proxy.ts's Care Coordinator allow-list, so all four bounced
                // straight to /dashboard/care-coordinator with no
                // explanation — a third of this sidebar led nowhere. Removed
                // rather than left dead. Two of the four are deliberate:
                //   - Case management is chronic-case clinical judgment.
                //   - Safeguarding's RLS only admits a Tier 3+/Clinical
                //     Director or the original reporter, so a Coordinator
                //     would see an all-but-empty page anyway.
                // Operations queue and Medication issues WERE also removed
                // for that reason, then restored on 2026-09-05 once proxy.ts's
                // isCoordinatorClinicianPath was extended to admit them. Both
                // were checked against the Coordinator write-access rule
                // first: the operations queue has no mutation anywhere in the
                // route, and medication-issues gates its clinical half in the
                // page itself. If either link is ever added back after being
                // removed again, extend the allow-list first: a link that
                // bounces is worse than no link.
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
                // SUP-1: one workspace over tickets, help requests, support messages and complaints.
                { label: "Support desk", href: "/clinician/support-desk", icon: "helpCenter" },
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
            // Support view-as is real here specifically because "Customer
            // support administrator" carries `support.view_as` (see
            // 20260922185119_support_view_as_customer_support_preset_grant.sql)
            // — unlike the other 3 delegated sections below (Clinical
            // administrator, Technical/Data & analytics administrator,
            // Finance administrator), whose presets do NOT carry it, so the
            // link stays deliberately absent there rather than bouncing.
            {
              label: "Operations",
              items: [
                { label: "Operations console", href: "/admin/ops", icon: "operations" },
                { label: "Incident register", href: "/admin/ops/incidents", icon: "siren" },
                { label: "Go-live guards (view)", href: "/admin/ops/go-live", icon: "governance" },
                { label: "Clinician roster", href: "/admin/ops/clinicians", icon: "members" },
                { label: "Reliability and SLA (view)", href: "/admin/ops/reliability", icon: "governance" },
                { label: "Operations wall", href: "/admin/ops/wall", icon: "operations" },
                { label: "Capacity and cover", href: "/admin/capacity", icon: "caseload" },
                { label: "Fire drills", href: "/admin/fire-drills", icon: "siren" },
                { label: "Ops desk", href: "/admin/ops/desk", icon: "siren" },
                { label: "Directory freshness", href: "/admin/ops/directory-freshness", icon: "review" },
                { label: "Partner chase list", href: "/admin/ops/directory-chase", icon: "review" },
                { label: "Lab and imaging directory", href: "/admin/ops/diagnostic-directory", icon: "review" },
                { label: "Automation health", href: "/admin/ops/automation-health", icon: "review" },
                { label: "Sign-up invites", href: "/admin/settings/signup-invites", icon: "members" },
                { label: "AI cost by month", href: "/admin/ops/ai-cost", icon: "governance" },
                { label: "AI monitoring", href: "/admin/ops/ai-monitoring", icon: "governance" },
                { label: "Support view-as", href: "/admin/support/view-as", icon: "patientActivity" },
                { label: "Prescription desk", href: "/admin/support/prescription-desk", icon: "patientActivity" },
              ],
            },
          ]
        : [
            {
              items: [
                ...(options?.cmo
                  ? [{ label: "Leadership overview", href: "/clinician/leadership", icon: "analytics" as const }]
                  : []),
                { label: options?.cmo ? "My clinical day" : "Today", href: "/clinician", icon: "dashboard", exact: true },
              ],
            },
            {
              // DW-02 (2026-11-06): daily clinical work first. Inboxes and queues where a patient or colleague
              // is waiting on this doctor; every item that can block someone keeps its live countKey badge.
              label: "Work",
              items: [
                // DW-01: every open escalation, alert and review item, named, most urgent first.
                { label: "My worklist", href: "/clinician/worklist", icon: "escalation" },
                // Declared hours, the on-call rota, cover requests (S18).
                // Red event pages sent to you: acknowledge, open the chart, close with a note (S19).
                // The Next task queue, the task I hold, and the patients I lead (S35).
                { label: "Next task", href: "/clinician/queue", icon: "escalation" },
                { label: "Escalations", href: "/clinician/escalations", icon: "escalation", countKey: "escalations" },
                {
                  label: "Results inbox",
                  href: "/clinician/results-inbox",
                  icon: "labs",
                  countKey: "resultsInboxAwaitingAction",
                },
                // S27: lab results held before the patient can see them (INV-03, INV-04).
                { label: "Lab results to review", href: "/clinician/lab-results", icon: "labs" },
                {
                  label: "Patient messages",
                  href: "/clinician/messages",
                  icon: "messages",
                  countKey: "careThreadsAwaitingReply",
                },
                { label: "Written questions", href: "/clinician/async-consults", icon: "inbox", countKey: "asyncConsults" },
                {
                  label: "Curbside consults",
                  href: "/clinician/curbside-consults",
                  icon: "messages",
                  countKey: "curbsideConsultsAwaitingReply",
                },
                // Orders, referrals, lab requests and follow-up tasks I own or am tied to; each closes only with an outcome and a reason (S77).
                { label: "My follow-ups", href: "/clinician/follow-ups", icon: "review" },
                { label: "On call", href: "/clinician/on-call", icon: "siren" },
              ],
            },
            {
              label: "Patients",
              items: [
                { label: "Patients", href: "/clinician/patients", icon: "parentCare" },
                { label: "My lead patients", href: "/clinician/lead-patients", icon: "patientActivity" },
                { label: "Appointments", href: "/clinician/appointments", icon: "booking" },
                // S21: today's and tomorrow's consultation rooms (spec 9.1, "Consultations").
                { label: "Consultations", href: "/clinician/consultations", icon: "booking" },
                { label: "Case management", href: "/clinician/case-management", icon: "carePlan", countKey: "activeCases" },
                // Two-tier model: offer each Member several times for the monthly check-in, see who is due or missed a month.
                { label: "Monthly check-ins", href: "/clinician/followups", icon: "booking" },
                // Chief Medical Officer only (canAssignCases in
                // lib/clinical/doctor-tier.ts) — shown to every clinician tier
                // per this file's own gating philosophy above; the page
                // itself redirects/shows a friendly message for anyone else.
                // Patients ordered by who may need a call first; only your own tied patients (S38c).
                { label: "Risk worklist", href: "/clinician/risk-worklist", icon: "analytics" },
                // Tied patients who may need a mental health follow-up, by fixed rules the CMO signs; shows nothing until signed (S56b). Doctors only: the database refuses coordinators.
                { label: "Mental health follow-ups", href: "/clinician/mental-health-worklist", icon: "mood", countKey: "mentalHealthWorklistWaiting" },
              ],
            },
            {
              // Specialist review queues. Kept in the sidebar (not on an index page) because most carry a live
              // count, and the pending-jobs banner reads its pills from the sidebar's countKeys.
              label: "Reviews",
              items: [
                // Symptom checks a patient asked the care team to look at, for patients the clinician holds a task for (S60).
                { label: "Symptom check reviews", href: "/clinician/symptom-reviews", icon: "review" },
                // Photos patients sent for the care team to look at, for patients the clinician holds a task for (S59).
                { label: "Photo reviews", href: "/clinician/skin-photo-reviews", icon: "review" },
                {
                  label: "Safeguarding",
                  href: "/clinician/safeguarding",
                  icon: "warning",
                  countKey: "openSafeguardingConcerns",
                },
                { label: "Care plan review", href: "/clinician/care-plan-review", icon: "carePlan", countKey: "carePlanReviewPrompts" },
                { label: "Recommendations", href: "/clinician/recommendations", icon: "carePlan", countKey: "recommendations" },
                { label: "Lifestyle reviews", href: "/clinician/lifestyle-reviews", icon: "lifestyle", countKey: "lifestyleReviews" },
                { label: "Lifestyle flags", href: "/clinician/lifestyle-flags", icon: "lifestyle", countKey: "lifestyleFlags" },
                { label: "Annual reviews", href: "/clinician/annual-reviews", icon: "review", countKey: "annualReviews" },
                { label: "Preventive reviews", href: "/clinician/preventive-reviews", icon: "preventive", countKey: "preventiveReviews" },
                // Added 2026-09-22 alongside the Preventive Health Check
                // Review SKU — before this, a paid-for Health Check review
                // had no queue anywhere; a doctor could only find one by
                // already knowing the patientId. See
                // 20260922185300_preventive_health_check_review_sku.sql.
                {
                  label: "Preventive Health Check reviews",
                  href: "/clinician/preventive-health-check-reviews",
                  icon: "preventive",
                  countKey: "preventiveHealthCheckReviewsWaiting",
                },
                {
                  label: "Sexual health cases",
                  href: "/clinician/sexual-health",
                  icon: "escalation",
                  countKey: "pendingEcRequests",
                },
                // Added 2026-09-10 with the therapy-approval clinical
                // product. Shown to every clinician tier, per this file's
                // gating philosophy: the authority rule lives in the database
                // (private.enforce_therapy_approver_authority), so a Care
                // Coordinator can see the queue and is refused if they try to
                // act on it, which is the right shape -- they route work,
                // they do not close clinical decisions.
                {
                  label: "Therapy approvals",
                  href: "/clinician/therapy-approvals",
                  icon: "mood",
                  countKey: "therapyApprovalsWaiting",
                },
                {
                  label: "Lab result consults",
                  href: "/clinician/lab-result-consults",
                  icon: "labs",
                  countKey: "labResultConsultsWaiting",
                },
                // Testing days and employer visits: urine and HbA1c results held for release, and ECG traces to read.
                { label: "Testing-day results", href: "/clinician/poc-results", icon: "labs" },
                // Real pages with no prior sidebar entry at all — previously
                // reachable only via the dashboard's "All worklists" strip,
                // so a doctor who didn't happen to scroll that far never
                // found them. See the countKey doc comment above.
                { label: "Second opinions", href: "/clinician/second-opinions", icon: "inbox", countKey: "secondOpinionRequests" },
                { label: "Senior case reviews", href: "/clinician/senior-case-reviews", icon: "escalation", countKey: "seniorCaseReviews" },
                { label: "Verified documents", href: "/clinician/verified-documents", icon: "inbox", countKey: "verifiedDocumentRequests" },
                {
                  label: "Record changes",
                  href: "/clinician/record-changes",
                  icon: "review",
                  countKey: "recordChangeRequestsWaiting",
                },
                {
                  label: "FHIR partner review",
                  href: "/clinician/fhir-review",
                  icon: "inbox",
                  countKey: "fhirProposedResourcesPending",
                },
                { label: "Yearly health reports", href: "/clinician/health-reports", icon: "carePlan" },
                // Say whether the automatic grade was right for a task you completed; off until the CMO approves (S38e).
                { label: "Review automatic grades", href: "/clinician/triage-review", icon: "review" },
              ],
            },
            {
              label: "Medicines",
              items: [
                {
                  label: "Medication issues",
                  href: "/clinician/medication-issues",
                  icon: "medication",
                  countKey: "openMedicationDispenseFlags",
                },
                { label: "Prescription renewals", href: "/clinician/prescription-renewals", icon: "medication", countKey: "prescriptionRenewalRequests" },
                // Questions a partner pharmacy asked about a prescription, and where each one has got to (S36h, S28).
                { label: "Pharmacy questions", href: "/clinician/pharmacy", icon: "medication" },
                { label: "Medication reviews", href: "/clinician/medication-reviews", icon: "medication", countKey: "medicationReviews" },
                { label: "Adherence alerts", href: "/clinician/adherence", icon: "medication", countKey: "adherenceAlerts" },
              ],
            },
            {
              label: "Orders and referrals",
              items: [
                {
                  label: "Orders",
                  href: "/clinician/orders",
                  icon: "logistics",
                  countKey: "labOrdersAwaitingHomeVisitAssignment",
                },
                { label: "Referrals", href: "/clinician/referrals", icon: "referral", countKey: "referralsNeedingUrgency" },
                { label: "Waitlisted referrals", href: "/clinician/referrals/waitlisted", icon: "referral", countKey: "waitlistedReferrals" },
                { label: "Vaccinations", href: "/clinician/vaccinations", icon: "vaccination", countKey: "vaccinationVerifications" },
              ],
            },
            {
              label: "Team",
              items: [
                {
                  label: "Operations queue",
                  href: "/clinician/operations-queue",
                  icon: "escalation",
                  countKey: "operationsQueueAlerts",
                },
                // MSG-5: what is waiting across messages, alerts and monthly meetings, and who holds it.
                { label: "Care operations", href: "/clinician/care-operations", icon: "operations" },
                // CC-1 (2026-11-07): doctors cover care coordination while no Care Coordinator is employed. The workspace itself
                // admits an employed Senior Medical Officer or the CMO and explains itself to anyone else.
                { label: "Care coordination", href: "/dashboard/care-coordinator", icon: "team" },
                {
                  label: "Support tickets",
                  href: "/clinician/support-tickets",
                  icon: "helpCenter",
                  countKey: "openSupportTickets",
                },
                {
                  label: "Complaints",
                  href: "/clinician/complaints",
                  icon: "governance",
                  countKey: "openComplaints",
                },
                {
                  label: "Safety incidents",
                  href: "/clinician/safety-incidents",
                  icon: "warning",
                  countKey: "openSafetyIncidents",
                },
                { label: "Outreach", href: "/clinician/outreach", icon: "messages", countKey: "outreach" },
                { label: "Team caseload", href: "/clinician/team-caseload", icon: "analytics" },
                // Chief Medical Officer only: every consultation in the organisation, the same log as /admin/consultations.
                { label: "Consultations log", href: "/clinician/consultations-log", icon: "booking" },
                // Community groups: the sign-off block lives on the hub above; this is the rest of the tools (rules, drill, member lookups). CMO and clinicians.
                { label: "Community", href: "/clinician/community", icon: "members" },
                { label: "Availability", href: "/clinician/availability", icon: "booking" },
                { label: "Hours and rota", href: "/clinician/rota", icon: "booking" },
                // Cover offers after a busy night and the 11 hour rest rule (S16-S20 Stage 5).
                { label: "Rest and cover", href: "/clinician/rest-and-cover", icon: "booking" },
                // Make this phone reliable for urgent pages, with a one-tap test page (S16-S20 Stage 5).
                { label: "Device check", href: "/clinician/device-check", icon: "siren" },
              ],
            },
            {
              label: "You",
              items: [
                { label: "My performance", href: "/clinician/my-performance", icon: "analytics" },
                // Finished audits of this clinician's own work, the first-20 count and the advisory reliability score, with a reply box (S20 v2). Their own only.
                { label: "My quality", href: "/clinician/my-quality", icon: "review" },
                // The concerns this clinician raised and the replies to them (S36i). Their own only.
                { label: "My concerns", href: "/clinician/my-concerns", icon: "review" },
                // Documents, licence and cover dates, level and renewal uploads (S15).
                { label: "Training and profile", href: "/clinician/credentials", icon: "review" },
                // What a contracted clinician has earned, line by line, and the fee schedule that applies (S30).
                { label: "Earnings", href: "/clinician/earnings", icon: "analytics" },
                { label: "Payouts", href: "/clinician/payouts", icon: "analytics" },
                // Chief Medical Officer only: minutes of doctor time per Member per month, for planning and pricing (W-01).
                { label: "Care team time", href: "/clinician/time", icon: "analytics" },
              ],
            },
            {
              label: "Governance",
              items: [
                // DW-02: one door to the governance, quality, rules and operations pages (index page).
                {
                  label: "Governance home",
                  href: "/clinician/governance",
                  icon: "governance",
                  alsoActiveFor: GOVERNANCE_HREFS,
                },
                // Leads the section on purpose: the one page that answers
                // "what still needs my signature, and what do I press"
                // across every governed table below, rather than making a
                // CMO check nine separate pages to find out. Added
                // 2026-09-22 alongside the rest of this section's entries —
                // before that, only 2 of the 9 governance pages below had a
                // /clinician mirror at all (Clinical protocols, Symptom
                // triage protocols); the other 7 plus this checklist were
                // reachable only via /admin, which a real CMO account
                // (always `profiles.role = "clinician"`) cannot open.
                { label: "Sign-off hub", href: "/clinician/clinical-signoff", icon: "review" },
              ],
            },
          ];
    case "admin":
      // Superadmin console sidebar (docs/design/SUPERADMIN-CONSOLE.md, founder approved 2026-11-07). It used to be one
      // flat "Operations" group of 86 links; it is now nine labelled groups that collapse to their headings, with the
      // less-used links in each group behind "More in this group" (`more: true`). Every page that was linked before is
      // still linked (admin-console-nav.test.ts asserts it). Settings-shaped pages also live behind the single
      // "Settings" entry, whose tab bar (admin/settings/layout.tsx) groups them; the clinical configuration pages that
      // were already direct links stay here too.
      return [
        {
          items: [
            { label: "Dashboard", href: "/admin", icon: "dashboard", exact: true },
            { label: "Admin sign-off", href: "/admin/sign-off", icon: "review" },
            { label: "Front desk", href: "/admin/front-desk", icon: "analytics" },
            { label: "Inbox", href: "/admin/inbox", icon: "members" },
            { label: "Follow-ups", href: "/admin/follow-ups", icon: "review" },
          ],
        },
        {
          label: "People and access",
          icon: "members",
          items: [
            { label: "Patients", href: "/admin/patients", icon: "members" },
            { label: "Clinician roster", href: "/admin/ops/clinicians", icon: "members" },
            // New clinician applications, document and licence checks, licence and indemnity expiry (S15).
            { label: "Clinician credentialing", href: "/admin/credentialing", icon: "review" },
            { label: "Sign-up invites", href: "/admin/settings/signup-invites", icon: "members" },
            { label: "Support desk", href: "/clinician/support-desk", icon: "helpCenter" },
            { label: "Support hand-offs", href: "/admin/support/handoffs", icon: "helpCenter" },
            { label: "Support view-as", href: "/admin/support/view-as", icon: "patientActivity" },
            { label: "Assisted account recovery", href: "/admin/account-recovery", icon: "privacy", more: true },
            { label: "Leads", href: "/admin/leads", icon: "members", more: true },
          ],
        },
        {
          label: "Care delivery",
          icon: "caseload",
          items: [
            { label: "Bookings", href: "/admin/bookings", icon: "booking" },
            // Every consultation: time, doctor, patient, doctor and Zoom connected minutes, CSV (founder/CMO ask 2026-11-03).
            { label: "Consultations log", href: "/admin/consultations", icon: "booking" },
            { label: "Doctor caseload", href: "/admin/staffing/caseload", icon: "caseload" },
            // Who is on call, who is declared to work, who leads each care pack patient (S18).
            { label: "Rota and lead clinicians", href: "/admin/rota", icon: "caseload" },
            { label: "Capacity and cover", href: "/admin/capacity", icon: "caseload" },
            { label: "Prescription desk", href: "/admin/support/prescription-desk", icon: "patientActivity" },
            // Community groups, topics, moderators, filter rules, the recorded member lookup.
            { label: "Community", href: "/admin/community", icon: "messages" },
            // The symptom checker's regulatory position, accuracy audit and safety settings (S60).
            { label: "Symptom checker safety", href: "/admin/symptom-safety", icon: "governance", more: true },
            { label: "Triage agreement", href: "/admin/triage-agreement", icon: "analytics", more: true },
            { label: "Task types and priorities", href: "/admin/task-types", icon: "settings", more: true },
            { label: "Testimonials", href: "/admin/testimonials", icon: "review", more: true },
            { label: "Doctor testimonials", href: "/admin/doctor-testimonials", icon: "review", more: true },
          ],
        },
        {
          label: "Organisations and partners",
          icon: "facilities",
          items: [
            { label: "Facilities", href: "/admin/facilities", icon: "hmo" },
            { label: "Lab and imaging directory", href: "/admin/ops/diagnostic-directory", icon: "review" },
            { label: "Directory queues", href: "/admin/directory-queues", icon: "review" },
            // How each laboratory, pharmacy and clinic is doing; pause or reinstate from new work (S74).
            { label: "Partner quality", href: "/admin/partner-quality", icon: "governance" },
            { label: "Employers", href: "/admin/employers", icon: "corporate" },
            // Programme codes for insurers, employers and NGOs, and their aggregate group figures (S38e).
            { label: "Sponsors", href: "/admin/sponsors", icon: "members" },
            { label: "Institution console", href: "/admin/sponsors/institution", icon: "members", more: true },
            { label: "Directory freshness", href: "/admin/ops/directory-freshness", icon: "review", more: true },
            { label: "Partner chase list", href: "/admin/ops/directory-chase", icon: "review", more: true },
            { label: "Provider quality", href: "/admin/provider-quality", icon: "governance", more: true },
            // Samples in flight, delays, rejected samples and re-collections per laboratory (S27h).
            { label: "Lab turnaround", href: "/admin/lab-turnaround", icon: "operations", more: true },
            // Turnaround to supply, flags, complaints and licence expiry for each partner pharmacy; a flag is a suggestion to review, never an automatic removal (S28e).
            { label: "Pharmacy scorecard", href: "/admin/pharmacy-scorecard", icon: "governance", more: true },
          ],
        },
        {
          label: "Membership and money",
          icon: "billing",
          items: [
            // Grant or end a Membership by hand (S22b).
            { label: "Memberships", href: "/admin/memberships", icon: "members" },
            // What can be bought, its price and its history; switch an item on or off (S25).
            { label: "Catalogue and prices", href: "/admin/catalogue", icon: "billing" },
            { label: "Refund requests", href: "/admin/refund-requests", icon: "billing" },
            { label: "Money reconciliation", href: "/finance/money-reconciliation", icon: "analytics" },
            { label: "Payouts", href: "/admin/payouts", icon: "analytics" },
            // Fee schedules, what contracted clinicians have earned, adjustments (S30).
            { label: "Fees and earnings", href: "/admin/earnings", icon: "analytics" },
            // What each organisation pays per Membership seat: the flat default, per-organisation prices, history (two-tier, C10).
            { label: "Organisation prices", href: "/admin/organisation-prices", icon: "billing", more: true },
            { label: "Promo codes", href: "/admin/promo-codes", icon: "billing", more: true },
            { label: "Membership discount codes", href: "/admin/discount-codes", icon: "billing", more: true },
            // Gifts to the Community Access Fund and the grants that pay for a named item for a named person (S72).
            { label: "Community Access Fund", href: "/admin/access-fund", icon: "billing", more: true },
            { label: "Earnings questions", href: "/admin/earnings/disputes", icon: "analytics", more: true },
            // What Tarragon owes a pharmacy or clinic from money it collected; labs are never on it (S74).
            { label: "Partner settlements", href: "/admin/partner-settlements", icon: "billing", more: true },
            { label: "Settlement tie-out", href: "/finance/settlement-tieout", icon: "analytics", more: true },
          ],
        },
        {
          label: "Outcomes and analytics",
          icon: "outcomes",
          items: [
            { label: "Analytics", href: "/analytics", icon: "analytics" },
            // Blood pressure control 90 days after joining: aggregate only, small numbers withheld (S38).
            { label: "Outcomes", href: "/admin/outcomes", icon: "analytics" },
            { label: "Response times", href: "/admin/outcomes/response-times", icon: "analytics" },
            // Care Circle adoption, engagement, gifts and safety: counts only, no names (Care Circle P5).
            { label: "Care Circle", href: "/admin/care-circle", icon: "analytics" },
            // Do Health Points and taking part change outcomes, or do healthier people just take part more? Internal, never published (OUTCOMES).
            { label: "Engagement and outcomes", href: "/admin/outcomes/engagement", icon: "analytics", more: true },
            // The founder's figures to today, small groups included. Super admin only; switched off by default; a reason is audited (OUTCOMES, OQ-OUT-09/11).
            { label: "Founder view (small groups)", href: "/admin/outcomes/engagement/founder", icon: "analytics", more: true },
            { label: "Risk fairness", href: "/admin/risk-fairness", icon: "analytics", more: true },
            { label: "Other outcome measures", href: "/admin/outcomes/measures", icon: "analytics", more: true },
            { label: "Cascade of care", href: "/admin/outcomes/cascade", icon: "analytics", more: true },
            { label: "Reliable change (PHQ-9, GAD-7)", href: "/admin/outcomes/reliable-change", icon: "analytics", more: true },
            { label: "Control by medicine adjustment", href: "/admin/outcomes/control-by-adjustment", icon: "analytics", more: true },
            { label: "Export outcomes", href: "/admin/outcomes/export", icon: "analytics", more: true },
          ],
        },
        {
          label: "Platform operations",
          icon: "operations",
          items: [
            { label: "Operations console", href: "/admin/ops", icon: "operations" },
            { label: "Ops desk", href: "/admin/ops/desk", icon: "siren" },
            { label: "Incident register", href: "/admin/ops/incidents", icon: "siren" },
            // Is the chain from a reading to a grade, task, page and notice working, and how fast (P1).
            { label: "Chain health", href: "/admin/ops/chain-health", icon: "operations" },
            { label: "Automation health", href: "/admin/ops/automation-health", icon: "review" },
            { label: "Providers", href: "/admin/ops/providers", icon: "operations" },
            { label: "Operations wall", href: "/admin/ops/wall", icon: "operations", more: true },
            { label: "Event bus", href: "/admin/ops/event-bus", icon: "operations", more: true },
            { label: "Partner webhooks", href: "/admin/ops/partner-webhooks", icon: "operations", more: true },
            { label: "Automations", href: "/admin/ops/automations", icon: "settings", more: true },
            { label: "Reliability and SLA (view)", href: "/admin/ops/reliability", icon: "governance", more: true },
            { label: "Fire drills", href: "/admin/fire-drills", icon: "siren", more: true },
            { label: "AI monitoring", href: "/admin/ops/ai-monitoring", icon: "governance", more: true },
            { label: "AI cost by month", href: "/admin/ops/ai-cost", icon: "governance", more: true },
          ],
        },
        {
          label: "Security and governance",
          icon: "security",
          items: [
            { label: "Security", href: "/admin/security", icon: "privacy" },
            { label: "Record access review", href: "/admin/access-review", icon: "audit" },
            { label: "Staff access review", href: "/admin/staff-access-review", icon: "audit" },
            { label: "Data rights requests", href: "/admin/data-rights", icon: "privacy" },
            // The go-live guards and the proposed values the founder owns (S37, G-01).
            { label: "Go-live guards", href: "/admin/go-live", icon: "governance" },
            { label: "AI governance", href: "/admin/settings/ai-governance", icon: "audit" },
            { label: "Go-live guards (view)", href: "/admin/ops/go-live", icon: "governance", more: true },
            { label: "AI cost", href: "/admin/settings/ai-governance/cost", icon: "audit", more: true },
          ],
        },
        {
          label: "Configuration",
          icon: "settings",
          items: [
            { label: "Settings", href: "/admin/settings", icon: "settings" },
            { label: "Escalation SLAs", href: "/admin/settings/escalation-slas", icon: "escalation", more: true },
            { label: "Symptom triage protocols", href: "/admin/settings/triage-protocols", icon: "escalation", more: true },
            { label: "Compare triage versions", href: "/admin/settings/triage-protocols/compare", icon: "escalation", more: true },
            { label: "Result release policies", href: "/admin/settings/result-release-policies", icon: "labs", more: true },
            { label: "CV-risk (cholesterol) config", href: "/admin/settings/cv-risk-config", icon: "bp", more: true },
            { label: "Vaccination schedule", href: "/admin/settings/vaccination-schedule", icon: "vaccination", more: true },
          ],
        },
      ];
    case "pharmacist":
      return [
        {
          items: [
            { label: "Overview", href: "/pharmacist", icon: "dashboard", exact: true },
            { label: "Orders", href: "/pharmacist/orders", icon: "pharmacy" },
            { label: "Prescriptions sent to you", href: "/pharmacist/prescriptions", icon: "medication" },
            { label: "Verify a prescription", href: "/pharmacist/verify", icon: "approvals" },
            { label: "Dispensing history", href: "/pharmacist/history", icon: "audit" },
            // S74: patient messages, partner statements, and the quality and sourcing check (module 21).
            { label: "Patient messages", href: "/pharmacist/messages", icon: "messages" },
            { label: "Statements", href: "/pharmacist/statements", icon: "billing" },
            { label: "Quality and sourcing", href: "/pharmacist/quality", icon: "governance" },
            { label: "Pharmacy profile", href: "/pharmacist/profile", icon: "settings" },
          ],
        },
      ];
    case "lab_partner":
      return [
        {
          items: [
            { label: "Dashboard", href: "/lab-partner", icon: "dashboard", exact: true },
            // S27: structured result entry (spec 9.6).
            { label: "Enter results", href: "/lab-partner/results", icon: "labs" },
            // S74: the laboratory's own quality check (turnaround, complaints, licence).
            { label: "Your quality check", href: "/lab-partner/quality", icon: "governance" },
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
        // self-gated, safe to always show. Support view-as is deliberately
        // NOT listed here — neither preset carries `support.view_as`, so the
        // link would always bounce (see the identical note in the
        // care_coordinator case above).
        {
          label: "Platform operations",
          items: [
            { label: "Operations console", href: "/admin/ops", icon: "operations" },
            { label: "Incident register", href: "/admin/ops/incidents", icon: "siren" },
            { label: "Go-live guards (view)", href: "/admin/ops/go-live", icon: "governance" },
                { label: "Clinician roster", href: "/admin/ops/clinicians", icon: "members" },
            { label: "Reliability and SLA (view)", href: "/admin/ops/reliability", icon: "governance" },
            { label: "Operations wall", href: "/admin/ops/wall", icon: "operations" },
            { label: "Capacity and cover", href: "/admin/capacity", icon: "caseload" },
            { label: "Fire drills", href: "/admin/fire-drills", icon: "siren" },
            { label: "Ops desk", href: "/admin/ops/desk", icon: "siren" },
            { label: "Directory freshness", href: "/admin/ops/directory-freshness", icon: "review" },
                { label: "Partner chase list", href: "/admin/ops/directory-chase", icon: "review" },
                { label: "Lab and imaging directory", href: "/admin/ops/diagnostic-directory", icon: "review" },
            { label: "Automation health", href: "/admin/ops/automation-health", icon: "review" },
            { label: "Sign-up invites", href: "/admin/settings/signup-invites", icon: "members" },
            { label: "AI cost by month", href: "/admin/ops/ai-cost", icon: "governance" },
            { label: "AI monitoring", href: "/admin/ops/ai-monitoring", icon: "governance" },
            { label: "Feature flags", href: "/admin/settings/feature-flags", icon: "flag" },
          ],
        },
      ];
    case "finance":
      // Finance v2 (docs/design/FINANCE-DASHBOARD-V2.md): grouped by what a finance
      // team does in a day. Only pages that exist are listed; later phases add theirs.
      return [
        {
          items: [
            { label: "Financial overview", href: "/finance", icon: "dashboard", exact: true },
          ],
        },
        {
          label: "Revenue",
          items: [
            { label: "Revenue recognition", href: "/finance/revenue", icon: "billing" },
            { label: "Employer billing", href: "/finance/employer-billing", icon: "billing" },
          ],
        },
        {
          label: "Payments",
          items: [
            { label: "Transactions", href: "/finance/transactions", icon: "billing" },
            { label: "Reconciliation", href: "/finance/reconciliation", icon: "reconcile", countKey: "financeReconciliationOpen" },
            { label: "Money reconciliation", href: "/finance/money-reconciliation", icon: "reconcile" },
            { label: "Settlement tie-out", href: "/finance/settlement-tieout", icon: "reconcile" },
            { label: "Laboratory settlements", href: "/finance/partner-settlements", icon: "payables" },
            { label: "Fraud signals", href: "/finance/fraud", icon: "warning", countKey: "financeFraudOpen" },
          ],
        },
        {
          label: "Accounting",
          items: [
            { label: "General ledger", href: "/finance/ledger", icon: "ledger" },
            { label: "Financial statements", href: "/finance/statements", icon: "statements" },
            { label: "Budgets", href: "/finance/budgets", icon: "budget" },
            { label: "Payables & vendors", href: "/finance/payables", icon: "payables" },
            { label: "Tax", href: "/finance/tax", icon: "tax" },
            { label: "Compliance calendar", href: "/finance/compliance", icon: "compliance" },
          ],
        },
        {
          label: "Reports",
          items: [
            { label: "Reports & filings", href: "/finance/reports", icon: "statements" },
          ],
        },
        {
          label: "Audit and controls",
          items: [
            { label: "Approvals", href: "/finance/approvals", icon: "approvals", countKey: "financeApprovalsPending" },
            { label: "Audit log", href: "/finance/audit", icon: "audit" },
          ],
        },
        // Only reachable for a Finance administrator holding the delegated
        // ops.console.view/incidents.* grant — self-gated, safe to show.
        // Support view-as is deliberately NOT listed here — the Finance
        // administrator preset carries no `support.view_as` grant, so the
        // link would always bounce (see the identical note in the
        // care_coordinator case above).
        {
          label: "Operations",
          items: [
            { label: "Operations console", href: "/admin/ops", icon: "operations" },
            { label: "Incident register", href: "/admin/ops/incidents", icon: "siren" },
            { label: "Go-live guards (view)", href: "/admin/ops/go-live", icon: "governance" },
                { label: "Clinician roster", href: "/admin/ops/clinicians", icon: "members" },
            { label: "Reliability and SLA (view)", href: "/admin/ops/reliability", icon: "governance" },
            { label: "Operations wall", href: "/admin/ops/wall", icon: "operations" },
            { label: "Capacity and cover", href: "/admin/capacity", icon: "caseload" },
            { label: "Fire drills", href: "/admin/fire-drills", icon: "siren" },
            { label: "Ops desk", href: "/admin/ops/desk", icon: "siren" },
            { label: "Directory freshness", href: "/admin/ops/directory-freshness", icon: "review" },
                { label: "Partner chase list", href: "/admin/ops/directory-chase", icon: "review" },
                { label: "Lab and imaging directory", href: "/admin/ops/diagnostic-directory", icon: "review" },
            { label: "Automation health", href: "/admin/ops/automation-health", icon: "review" },
            { label: "Sign-up invites", href: "/admin/settings/signup-invites", icon: "members" },
            { label: "AI cost by month", href: "/admin/ops/ai-cost", icon: "governance" },
            { label: "AI monitoring", href: "/admin/ops/ai-monitoring", icon: "governance" },
          ],
        },
        {
          label: "Setup",
          items: [
            { label: "Periods & accounts", href: "/finance/settings", icon: "settings" },
            { label: "Finance glossary", href: "/finance/glossary", icon: "ledger" },
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
            { label: "Outcomes reports", href: "/payer/board-report", icon: "statements" },
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
    // Module ngo_funded_cohort — built dormant (platform_modules.
    // ngo_funded_cohort, off by default). Same posture as the payer/
    // provider-org nav above: /ngo itself checks module + role server-side
    // and renders a "not yet activated" placeholder when the module is off.
    case "ngo_admin":
      return [
        {
          items: [{ label: "Overview", href: "/ngo", icon: "dashboard", exact: true }],
        },
      ];
    default:
      return [];
  }
}


/**
 * Doctor workspace DW-02 (2026-11-06): the governance, quality and operations pages, moved out of the doctor's
 * sidebar onto one index page (/clinician/governance) so the sidebar holds daily clinical work. No URL changed.
 * Every page here is still reachable: from that index, and from the Chief Medical Officer's search, which
 * indexes these sections alongside the sidebar (see (dashboard)/layout.tsx). No item here carries a countKey,
 * so the pending-jobs banner, which reads the sidebar's countKeys, is unaffected.
 *
 * Carried over from the old sidebar groups:
 *  - Governance pages are /clinician mirrors because a CMO account is always `clinician` and cannot open /admin.
 *    They are listed for every doctor; each page redirects or explains for anyone below the CMO.
 *  - "Operations administration" is reachable only with a delegated ops.console.view / incidents.* grant (the
 *    "Clinical administrator" preset); the pages self-gate, so the links are safe to show. Support view-as is
 *    deliberately NOT listed: that preset carries no `support.view_as` grant, so the link would always bounce.
 */
const GOVERNANCE_SECTIONS: NavSection[] = [
  {
    label: "Quality and outcomes",
    items: [
      // Audits of completed clinical work and hand-back reviews (S36c). CMO only; the page redirects anyone below that tier.
      { label: "Quality and safety", href: "/clinician/quality", icon: "review" },
      { label: "Diabetes quality", href: "/clinician/diabetes-quality", icon: "diabetes" },
      { label: "Hypertension quality", href: "/clinician/hypertension-quality", icon: "bp" },
      { label: "Obesity quality", href: "/clinician/obesity-quality", icon: "weight" },
      {
        label: "Quality improvement",
        href: "/clinician/quality-improvement",
        icon: "review",
      },
      { label: "Population health", href: "/clinician/populations", icon: "population" },
      // Chief Medical Officer only: the cascade of care (screened, diagnosed, on a medicine, controlled) for hypertension and diabetes; shows nothing until the CMO signs the definitions (WP3).
      { label: "Cascade of care", href: "/clinician/outcomes/cascade", icon: "analytics" },
      // Do Health Points and taking part change outcomes, or do healthier people just take part more? Engagement and outcomes kept apart (OUTCOMES). CMO only; the page redirects others.
      { label: "Engagement and outcomes", href: "/clinician/engagement-outcomes", icon: "analytics" },
      // Chief Medical Officer only: alerts, pages, doctor reviews and emergencies as a ratio, and how often the lead handled the task (S16-S20 W6.3).
      { label: "Care funnel", href: "/clinician/funnel", icon: "analytics" },
      // Chief Medical Officer only: is the chain from a reading to a grade, task, page and notice working, and how fast (P1).
      { label: "Chain health", href: "/clinician/chain-health", icon: "operations" },
      // Chief Medical Officer only: how AI scribe drafts are used, and a random sample to check (S35c).
      { label: "Scribe quality", href: "/clinician/scribe-quality", icon: "analytics" },
      { label: "Provider quality", href: "/clinician/provider-quality", icon: "analytics" },
      { label: "Device operations", href: "/clinician/device-operations", icon: "devices" },
      { label: "Data deletion requests", href: "/clinician/data-deletion-requests", icon: "compliance" },
      // Chief Medical Officer only: learning content coming up for its review date, who owns it and what is already hidden (S55 expiry backlog).
      { label: "Learning content review", href: "/clinician/learning-review", icon: "review" },
      { label: "Content review backlog", href: "/clinician/content-review-backlog", icon: "review" },
    ],
  },
  {
    label: "Clinical oversight",
    items: [
      // Private safety concerns raised by clinicians, backup readers and retaliation reviews (S36i). CMO only; the page redirects others.
      { label: "Safety concerns", href: "/clinician/quality/concerns", icon: "governance" },
      // New clinician applications, licence and cover expiry, and the training and test content (S15).
      // Chief Medical Officer only; the pages redirect anyone below that tier.
      { label: "Clinician credentialing", href: "/clinician/credentialing", icon: "review" },
      // Every clinician with status, licence, competencies; decide competency grants and reinstatements, pause someone (S36d). CMO only; the page redirects others.
      { label: "Clinician roster", href: "/clinician/roster", icon: "members" },
      // The on-call rota, declared on-call hours and lead clinicians (S18). Chief Medical Officer only; the page redirects anyone below that tier.
      { label: "Rota and lead clinicians", href: "/clinician/team-rota", icon: "caseload" },
      // Claims, completed, hand-backs and time to complete per clinician, advisory only (S78c). CMO only; the page redirects others.
      { label: "Clinician workload", href: "/clinician/workload", icon: "caseload" },
      // Intake gate, surge mode, pause, rest-rule override and cover offers; and the monthly fire drills (S16-S20 Stage 5). CMO only; the pages redirect others.
      { label: "Capacity and cover", href: "/clinician/capacity", icon: "caseload" },
      // Queue and page times against their limits, on-call cover and reliability bands (S36e). CMO only; the page redirects others.
      { label: "Reliability and SLA", href: "/clinician/reliability", icon: "caseload" },
      { label: "Fire drills", href: "/clinician/fire-drills", icon: "siren" },
      { label: "Ops desk", href: "/clinician/ops-desk", icon: "siren" },
      // The go-live guards and the proposed values the CMO owns (S37). CMO only; the page redirects anyone below that tier.
      { label: "Go-live guards", href: "/clinician/go-live", icon: "governance" },
      // The symptom checker's regulatory position, accuracy audit and safety settings (S60). CMO only; the page redirects others.
      { label: "Symptom checker safety", href: "/clinician/symptom-safety", icon: "governance" },
      // Weekly payout drafts the CMO may approve (S36j, founder decision 2026-10-06). CMO only; the page redirects others. Sending stays with the admin.
      { label: "Payout approvals", href: "/clinician/payout-approvals", icon: "governance" },
      // Grant or end a Membership by hand until checkout exists (S22b). CMO only; the page redirects others.
      { label: "Memberships", href: "/clinician/memberships", icon: "members" },
      { label: "Research protocols", href: "/clinician/research", icon: "governance" },
    ],
  },
  {
    label: "AI oversight",
    items: [
      // The AI governance console's two CMO-only actions (approving
      // an ai_system_versions row, labelling an ai_evaluation_cases
      // clinical-accuracy scenario) — same reachability gap as
      // Clinical sign-off above, closed the same way. See that
      // page's own comment for the admin-banner/proxy.ts history.
      { label: "AI governance sign-off", href: "/clinician/ai-governance", icon: "review" },
      { label: "AI answer review", href: "/clinician/ai-review", icon: "review" },
      // The monthly review of a sample of assistant conversations, plus every reported one (S52). CMO only; the page redirects anyone below that tier.
      { label: "Assistant monthly review", href: "/clinician/assistant-review", icon: "review" },
      { label: "AI monitoring", href: "/clinician/ai-monitoring", icon: "governance" },
      // Chief Medical Officer only: sign the AI Health Coach risk acceptance and see its dated re-evaluation (W-10).
      { label: "AI coach risk acceptance", href: "/clinician/ai-risk-acceptance", icon: "review" },
    ],
  },
  {
    label: "Rules and protocols",
    items: [
      { label: "Clinical protocols", href: "/clinician/protocols", icon: "review" },
      { label: "Titration protocols", href: "/clinician/titration-protocols", icon: "review" },
      { label: "Symptom triage protocols", href: "/clinician/triage-protocols", icon: "review" },
      { label: "Compare triage versions", href: "/clinician/triage-protocols/compare", icon: "review" },
      { label: "Blood pressure triage rules", href: "/clinician/triage-rules", icon: "bp" },
      { label: "Glucose triage rules", href: "/clinician/glucose-triage-rules", icon: "bp" },
      { label: "Pulse, oxygen and temperature triage rules", href: "/clinician/vitals-triage-rules", icon: "bp" },
      // N-overrides: the CMO's roster of personal alert thresholds, the monthly review and the kill switch.
      { label: "Personal alert thresholds", href: "/clinician/threshold-overrides", icon: "bp" },
      { label: "Task types and priorities", href: "/clinician/task-types", icon: "review" },
      { label: "Clinical rules engine", href: "/clinician/clinical-rules", icon: "governance" },
      { label: "Alert rules", href: "/clinician/alert-rules", icon: "siren" },
      { label: "Escalation SLAs", href: "/clinician/escalation-slas", icon: "escalation" },
      { label: "CV-risk (cholesterol) config", href: "/clinician/cv-risk-config", icon: "bp" },
      {
        label: "Risk questionnaire configuration",
        href: "/clinician/risk-questionnaire-config",
        icon: "review",
      },
      {
        label: "Mental health screening cadences",
        href: "/clinician/mental-health-screening",
        icon: "preventive",
      },
      {
        label: "Provider quality policy",
        href: "/clinician/provider-quality-policy",
        icon: "review",
      },
      { label: "Vaccination schedule", href: "/clinician/vaccination-schedule", icon: "vaccination" },
      { label: "As-needed medicine limits", href: "/clinician/prn-limit-rules", icon: "review" },
      { label: "Medicine interaction rules", href: "/clinician/medicine-interaction-rules", icon: "review" },
      { label: "Medicine brand names", href: "/clinician/medicine-brand-map", icon: "review" },
    ],
  },
  {
    label: "Operations administration",
    items: [
      { label: "Operations console", href: "/admin/ops", icon: "operations" },
      { label: "Incident register", href: "/admin/ops/incidents", icon: "siren" },
      { label: "Go-live guards (view)", href: "/admin/ops/go-live", icon: "governance" },
      { label: "Clinician roster", href: "/admin/ops/clinicians", icon: "members" },
      { label: "Reliability and SLA (view)", href: "/admin/ops/reliability", icon: "governance" },
      { label: "Operations wall", href: "/admin/ops/wall", icon: "operations" },
      { label: "Capacity and cover", href: "/admin/capacity", icon: "caseload" },
      { label: "Fire drills", href: "/admin/fire-drills", icon: "siren" },
      { label: "Ops desk", href: "/admin/ops/desk", icon: "siren" },
      { label: "Directory freshness", href: "/admin/ops/directory-freshness", icon: "review" },
      { label: "Partner chase list", href: "/admin/ops/directory-chase", icon: "review" },
      { label: "Lab and imaging directory", href: "/admin/ops/diagnostic-directory", icon: "review" },
      { label: "Automation health", href: "/admin/ops/automation-health", icon: "review" },
      { label: "Sign-up invites", href: "/admin/settings/signup-invites", icon: "members" },
      { label: "AI cost by month", href: "/admin/ops/ai-cost", icon: "governance" },
      { label: "AI monitoring", href: "/admin/ops/ai-monitoring", icon: "governance" },
    ],
  },
];
/**
 * Everything a doctor's search should reach: the sidebar plus the governance index (DW-02). The Chief Medical
 * Officer's search box is built from this, so moving a page off the sidebar never makes it unfindable.
 */
export const CLINICIAN_GOVERNANCE_SECTIONS: readonly NavSection[] = GOVERNANCE_SECTIONS;

/** Every href on the Governance index; the sidebar's Governance home link is lit on all of them. */
export const GOVERNANCE_HREFS: readonly string[] = GOVERNANCE_SECTIONS.flatMap((s) => s.items.map((i) => i.href));

/** The Chief Medical Officer's search index (the only caller), so it includes their Leadership overview. */
export function clinicianSearchSections(): NavSection[] {
  return [...getNavSections("clinician", null, { cmo: true }), ...CLINICIAN_GOVERNANCE_SECTIONS];
}

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Whether a sidebar link is the current page (or one it stands in for, see `alsoActiveFor`). */
export function itemIsActive(pathname: string, item: Pick<NavItem, "href" | "exact" | "alsoActiveFor">): boolean {
  return isActive(pathname, item.href, item.exact) || (item.alsoActiveFor ?? []).some((h) => isActive(pathname, h));
}

/** Whether a phone bottom-bar tab shows as active: its own pages, plus the pages it stands for on the phone only. */
export function tabIsActive(
  pathname: string,
  item: Pick<NavItem, "href" | "exact" | "alsoActiveFor" | "tabAlsoActiveFor">,
): boolean {
  return itemIsActive(pathname, item) || (item.tabAlsoActiveFor ?? []).some((h) => isActive(pathname, h));
}

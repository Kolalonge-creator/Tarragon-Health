import { getNavSections } from "./navigation";

/**
 * The superadmin sidebar was regrouped on 2026-11-07 from one flat "Operations" group of 86 links into nine labelled
 * groups (docs/design/SUPERADMIN-CONSOLE.md). These tests stop a later edit from silently dropping a page out of the
 * menu, which is how six admin pages (Security among them) ended up reachable only through search.
 */

/** Every admin sidebar link that existed before the regroup. Remove one only on purpose, with the page it moved to. */
const LINKED_BEFORE_REGROUP = [
  "/admin",
  "/admin/access-fund",
  "/admin/bookings",
  "/admin/capacity",
  "/admin/care-circle",
  "/admin/catalogue",
  "/admin/community",
  "/admin/consultations",
  "/admin/credentialing",
  "/admin/data-rights",
  "/admin/directory-queues",
  "/admin/discount-codes",
  "/admin/doctor-testimonials",
  "/admin/earnings",
  "/admin/earnings/disputes",
  "/admin/employers",
  "/admin/facilities",
  "/admin/fire-drills",
  "/admin/follow-ups",
  "/admin/front-desk",
  "/admin/go-live",
  "/admin/inbox",
  "/admin/lab-turnaround",
  "/admin/leads",
  "/admin/memberships",
  "/admin/ops",
  "/admin/ops/ai-cost",
  "/admin/ops/ai-monitoring",
  "/admin/ops/automation-health",
  "/admin/ops/automations",
  "/admin/ops/chain-health",
  "/admin/ops/clinicians",
  "/admin/ops/desk",
  "/admin/ops/diagnostic-directory",
  "/admin/ops/directory-chase",
  "/admin/ops/directory-freshness",
  "/admin/ops/event-bus",
  "/admin/ops/go-live",
  "/admin/ops/incidents",
  "/admin/ops/partner-webhooks",
  "/admin/ops/providers",
  "/admin/ops/reliability",
  "/admin/ops/wall",
  "/admin/organisation-prices",
  "/admin/outcomes",
  "/admin/outcomes/cascade",
  "/admin/outcomes/control-by-adjustment",
  "/admin/outcomes/engagement",
  "/admin/outcomes/engagement/founder",
  "/admin/outcomes/export",
  "/admin/outcomes/measures",
  "/admin/outcomes/reliable-change",
  "/admin/outcomes/response-times",
  "/admin/partner-quality",
  "/admin/partner-settlements",
  "/admin/patients",
  "/admin/payouts",
  "/admin/pharmacy-scorecard",
  "/admin/promo-codes",
  "/admin/provider-quality",
  "/admin/risk-fairness",
  "/admin/rota",
  "/admin/settings",
  "/admin/settings/ai-governance",
  "/admin/settings/ai-governance/cost",
  "/admin/settings/cv-risk-config",
  "/admin/settings/escalation-slas",
  "/admin/settings/result-release-policies",
  "/admin/settings/signup-invites",
  "/admin/settings/triage-protocols",
  "/admin/settings/triage-protocols/compare",
  "/admin/settings/vaccination-schedule",
  "/admin/sign-off",
  "/admin/sponsors",
  "/admin/sponsors/institution",
  "/admin/staffing/caseload",
  "/admin/support/prescription-desk",
  "/admin/support/view-as",
  "/admin/symptom-safety",
  "/admin/testimonials",
  "/admin/triage-agreement",
  "/analytics",
  "/finance/money-reconciliation",
  "/finance/settlement-tieout",] as const;

/** Admin pages that had no sidebar link before the regroup and gained one in it. */
const ADDED_IN_REGROUP = [
  "/admin/security",
  "/admin/access-review",
  "/admin/staff-access-review",
  "/admin/account-recovery",
  "/admin/task-types",
  "/admin/refund-requests",
] as const;

const GROUPS = [
  "People and access",
  "Care delivery",
  "Organisations and partners",
  "Membership and money",
  "Outcomes and analytics",
  "Platform operations",
  "Security and governance",
  "Configuration",
];

const sections = getNavSections("admin", null);
const hrefs = sections.flatMap((s) => s.items.map((i) => i.href));

describe("admin console sidebar", () => {
  it("keeps every link that existed before the regroup", () => {
    const missing = LINKED_BEFORE_REGROUP.filter((href) => !hrefs.includes(href));
    expect(missing).toEqual([]);
  });

  it("links the admin pages that used to be reachable only through search", () => {
    const missing = ADDED_IN_REGROUP.filter((href) => !hrefs.includes(href));
    expect(missing).toEqual([]);
  });

  it("lists no page twice", () => {
    const dupes = hrefs.filter((href, i) => hrefs.indexOf(href) !== i);
    expect(dupes).toEqual([]);
  });

  it("has an unlabelled top band (the overview) and then the eight labelled groups, in order", () => {
    expect(sections[0].label).toBeUndefined();
    expect(sections.slice(1).map((s) => s.label)).toEqual(GROUPS);
  });

  it("keeps each group scannable: at most eight links before 'More in this group', and at least one always shown", () => {
    for (const section of sections) {
      const shown = section.items.filter((i) => !i.more);
      expect({ group: section.label, shown: shown.length >= 1 && shown.length <= 8 }).toEqual({ group: section.label, shown: true });
    }
  });

  it("never hides the Dashboard or a group's first link behind 'More'", () => {
    for (const section of sections) expect(section.items[0].more).not.toBe(true);
  });
});

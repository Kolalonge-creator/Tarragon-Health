import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { checkDependencies, type DependencyReport } from "@/lib/status/check-dependencies";
import { businessSummarySchema, financialSummarySchema } from "@/lib/analytics/schemas";
import { formatMinor, formatNumber } from "@/lib/analytics/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { LoadFailure } from "@/components/ui/load-failure";
import { anyQueryFailed, failedQueryLabels, joinLabels } from "@/lib/queries/server-query-state";
import { readPendingAiGovernanceSignoff } from "@/lib/queries/pending-ai-governance-signoff";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";
import { OpenAdminSearchBar } from "@/components/shell/open-admin-search-bar";
import { attentionView, dependenciesDown, figure, type AttentionItem } from "@tarragon/shared";
import { AttentionHero } from "./attention-hero";

export const metadata = { title: "Dashboard" };

type AdminTile = {
  href: string;
  label: string;
  blurb: string;
  icon: LucideIcon;
  visible: boolean;
};

type AdminTileGroup = {
  label: string;
  tiles: AdminTile[];
};

/** "up"/"configured" reads as healthy, "down" as a real problem, "unconfigured"
 * and "not_deployed" as neutral — a provider nobody's set up yet isn't a fault. */
function statusBadgeVariant(status: string): "green" | "red" | "grey" {
  if (status === "down") return "red";
  if (status === "unconfigured" || status === "not_deployed") return "grey";
  return "green";
}

const DEPENDENCY_LABELS: Record<keyof Omit<DependencyReport, "checked_at">, string> = {
  supabase: "Supabase",
  ml_service: "ML service",
  termii: "Termii SMS",
  paystack: "Paystack",
  resend: "Resend (email)",
};

export default async function AdminPage() {
  const profile = await getCurrentProfile();

  const { isSuperAdmin, keys } = await getCallerPermissions();
  const canManageUsers =
    isSuperAdmin ||
    keys.has("users.provision") ||
    keys.has("users.roles.assign") ||
    keys.has("users.permissions.grant") ||
    keys.has("roles.manage");
  const canManagePartners =
    isSuperAdmin ||
    ["partners.labs.manage", "partners.pharmacies.manage", "partners.facilities.manage", "partners.specialists.manage", "partners.home_visit.manage", "partners.logistics.manage"].some(
      (k) => keys.has(k)
    );
  const canViewAnalytics = isSuperAdmin || keys.has("analytics.view");
  // A member only sees an operational tile if they can actually use that surface.
  // Tiles with no dedicated capability key stay super-admin-only.
  const can = (key: string) => isSuperAdmin || keys.has(key);
  // Mirrors private.can_view_ops_console(): private.is_analyst() (role in
  // ('analyst', 'admin')) OR the ops.console.view grant.
  const canViewOps =
    isSuperAdmin || profile?.role === "analyst" || keys.has("ops.console.view");
  const canViewIncidents = isSuperAdmin || keys.has("incidents.view") || keys.has("incidents.manage");
  const canManageAiGovernance = isSuperAdmin || keys.has("ai_governance.manage");

  // Platform KPIs for the welcome banner + stat row. The RPCs return
  // '{}' (parsed to all-zero defaults) for a caller who isn't analyst/admin,
  // and the count queries return 0 rows rather than erroring under RLS — so
  // this is safe to call unconditionally for any role that can reach /admin
  // via the delegated-access carve-out in proxy.ts.
  // Corrected 2026-09-18: businessRes below is no longer live-aggregated —
  // analytics_business_summary() now reads a nightly-refreshed snapshot
  // (docs/DATA_ARCHITECTURE_GAPS_BUILD_PLAN.md §3); it carries its own
  // `_computed_at` for a consumer that wants to show staleness, which this
  // banner does not yet do (see the full "as of"/refresh treatment on
  // /analytics/business instead).
  const supabase = await createClient();
  const [
    businessRes,
    financialRes,
    activeClinicianRes,
    pendingVerificationRes,
    openBookingsRes,
    pendingBookingsRes,
    dependencyReport,
    aiGovernanceSignoff,
    incidentsRes,
  ] = await Promise.all([
    supabase.rpc("analytics_business_summary"),
    supabase.rpc("analytics_financial_summary"),
    supabase.from("clinical_staff").select("id", { count: "exact", head: true }).eq("active", true),
    supabase
      .from("clinical_staff")
      .select("id", { count: "exact", head: true })
      .is("license_verified_at", null),
    supabase
      .from("booking_requests")
      .select("*", { count: "exact", head: true })
      .in("status", ["requested", "confirmed"]),
    supabase
      .from("booking_requests")
      .select("*", { count: "exact", head: true })
      .eq("status", "requested"),
    // Same checks the unauthenticated /api/status route exposes — called
    // directly here rather than fetched, since this page already renders
    // server-side. See docs/BUSINESS_CONTINUITY_DR_SPEC.md.
    checkDependencies(),
    // AI governance (Module 40) is easy to lose track of — it lives one tile
    // among ~60 on this page, and the two counts below are real,
    // time-sensitive work sitting on a Chief Medical Officer's desk, not
    // background configuration. Surfaced in the welcome banner below rather
    // than left for someone to happen across the tile. Shared with the
    // clinician-reachable mirror (/clinician/ai-governance) via
    // readPendingAiGovernanceSignoff so the two counts can never drift.
    readPendingAiGovernanceSignoff(supabase),
    // Serious incidents still being worked (sev1 and sev2, not yet resolved). Only read for someone who may see the register; RLS
    // would return nothing to anyone else, and "nothing" must not be drawn as "none".
    canViewIncidents
      ? supabase
          .from("ops_incidents")
          .select("id", { count: "exact", head: true })
          .in("status", ["open", "investigating"])
          .in("severity", ["sev1", "sev2"])
      : Promise.resolve(null),
  ]);

  const business = businessSummarySchema.parse(businessRes.data ?? {});
  const financial = financialSummarySchema.parse(financialRes.data ?? {});
  const activeClinicianCount = activeClinicianRes.count ?? 0;
  const pendingVerificationCount = pendingVerificationRes.count ?? 0;
  const openBookingsCount = openBookingsRes.count ?? 0;
  const pendingBookingsCount = pendingBookingsRes.count ?? 0;
  const pendingAiVersionApprovalCount = aiGovernanceSignoff.pendingVersionApprovalCount;
  const pendingClinicalAccuracyLabelCount = aiGovernanceSignoff.pendingClinicalAccuracyLabelCount;
  const pendingAiGuardrailCount = aiGovernanceSignoff.pendingGuardrailApprovalCount;
  const pendingAiKnowledgeSourceCount = aiGovernanceSignoff.pendingKnowledgeSourceApprovalCount;
  const aiGovernanceFailed = aiGovernanceSignoff.failed;
  const aiGovernanceAttentionCount = aiGovernanceSignoff.attentionCount;

  // Six reads, four tiles and one welcome sentence, all of which used to
  // render a confident zero on failure. The `?? 0` and `?? {}` above are what
  // made that invisible: they are fine as defaults for a successful read that
  // genuinely returned nothing, and a lie for a read that never happened.
  // Tracked per tile rather than per page so a single broken RPC does not
  // blank three tiles that loaded perfectly well.
  const patientsFailed = businessRes.error !== null;
  const revenueFailed = financialRes.error !== null;
  const cliniciansFailed = anyQueryFailed([activeClinicianRes, pendingVerificationRes]);
  const bookingsFailed = anyQueryFailed([openBookingsRes, pendingBookingsRes]);
  const failedTiles = failedQueryLabels([
    { label: "patient numbers", error: businessRes.error },
    { label: "revenue", error: financialRes.error },
    { label: "clinician counts", error: cliniciansFailed ? true : null },
    { label: "booking counts", error: bookingsFailed ? true : null },
  ]);

  // Revenue, not MRR: the app is free and Tarragon charges per piece of doctor
  // work, so there is nothing recurring to report (2026-09-02 cutover).
  const revenue90dDisplay = formatMinor(financial.revenue_90d_kobo, "NGN");

  // What needs this person, ranked by @tarragon/shared's attentionView. An item is only listed for someone who can act on it, and an
  // item whose read failed is unknown, never zero: that is what stops a broken read becoming "caught up".
  const aiGovernanceLabel = [
    pendingAiVersionApprovalCount > 0 &&
      `${formatNumber(pendingAiVersionApprovalCount)} AI system version${pendingAiVersionApprovalCount === 1 ? "" : "s"} awaiting your approval`,
    pendingClinicalAccuracyLabelCount > 0 &&
      `${formatNumber(pendingClinicalAccuracyLabelCount)} clinical-accuracy scenario${pendingClinicalAccuracyLabelCount === 1 ? "" : "s"} awaiting your tier judgement`,
    pendingAiGuardrailCount > 0 &&
      `${formatNumber(pendingAiGuardrailCount)} guardrail${pendingAiGuardrailCount === 1 ? "" : "s"} awaiting your approval`,
    pendingAiKnowledgeSourceCount > 0 &&
      `${formatNumber(pendingAiKnowledgeSourceCount)} knowledge source${pendingAiKnowledgeSourceCount === 1 ? "" : "s"} awaiting your approval`,
  ]
    .filter(Boolean)
    .join(" and ");
  const attentionItems: AttentionItem[] = [];
  if (canViewIncidents && incidentsRes) {
    attentionItems.push({
      key: "serious_incidents",
      label: (n) => `${formatNumber(n)} serious incident${n === 1 ? "" : "s"} still open`,
      href: "/admin/ops/incidents",
      count: figure(incidentsRes.count, incidentsRes.error !== null),
    });
  }
  if (canManageAiGovernance) {
    attentionItems.push({
      key: "ai_governance",
      label: () => aiGovernanceLabel,
      href: "/admin/settings/ai-governance",
      count: figure(aiGovernanceAttentionCount, aiGovernanceFailed),
    });
  }
  attentionItems.push(
    {
      key: "clinician_verification",
      label: (n) => `${formatNumber(n)} clinician verification${n === 1 ? "" : "s"} to complete`,
      href: "/admin/settings/clinical-staff",
      count: figure(pendingVerificationRes.count, pendingVerificationRes.error !== null),
    },
    {
      key: "booking_requests",
      label: (n) => `${formatNumber(n)} pending booking request${n === 1 ? "" : "s"}`,
      href: "/admin/bookings",
      count: figure(pendingBookingsRes.count, pendingBookingsRes.error !== null),
    },
  );
  const attention = attentionView(attentionItems);
  const downDependencies = dependenciesDown(dependencyReport);

  const groups: AdminTileGroup[] = [
    {
      label: "People & access",
      tiles: [
        {
          href: "/admin/settings/members",
          label: "Members & access",
          blurb: "Create logins, assign roles, and delegate specific capabilities",
          icon: NAV_ICON.members,
          visible: canManageUsers,
        },
        {
          href: "/admin/settings/clinical-staff",
          label: "Clinical staff",
          blurb: "Add and verify every MDCN/NMCN-credentialed doctor",
          icon: SEMANTIC_ICON.clinicianFollowUp,
          visible: can("clinical_staff.manage"),
        },
        {
          href: "/admin/settings/provider-restrictions",
          label: "Provider restrictions",
          blurb: "Staged, reason-coded suspension workflow for clinical staff",
          icon: SEMANTIC_ICON.clinicianFollowUp,
          visible: isSuperAdmin,
        },
        {
          href: "/admin/leads",
          label: "Leads",
          blurb: "Contact form and plan-finder submissions, including B2B",
          icon: NAV_ICON.inbox,
          visible: can("leads.manage"),
        },
        {
          href: "/admin/patients/directory",
          label: "Patient directory",
          blurb: "Every patient with plan, sign-ins, activity and time spent, with an Excel download",
          icon: SEMANTIC_ICON.parentCare,
          visible: true,
        },
        {
          href: "/admin/patients/duplicates",
          label: "Duplicate patients",
          blurb: "Review flagged possible-duplicate patient records",
          icon: NAV_ICON.review,
          visible: can("patients.duplicates.review") || can("patients.merge"),
        },
      ],
    },
    {
      label: "Partner network",
      tiles: [
        {
          href: "/admin/settings/partners",
          label: "Partners",
          blurb: "Labs, pharmacies, hospitals, specialists, logistics",
          icon: SEMANTIC_ICON.labs,
          visible: canManagePartners,
        },
        {
          href: "/admin/facilities",
          label: "Facility directory",
          blurb: "Facilities patients can browse and request bookings from",
          icon: SEMANTIC_ICON.hmo,
          visible: can("partners.facilities.manage"),
        },
        {
          href: "/admin/settings/logistics-partners",
          label: "Home visit & delivery",
          blurb: "Home-collection and delivery partners, by region",
          icon: SEMANTIC_ICON.logistics,
          visible: can("partners.home_visit.manage") || can("partners.logistics.manage"),
        },
        {
          href: "/admin/settings/commissions",
          label: "Commission tracking",
          blurb: "Partner-network commissions earned, owed, and paid",
          icon: SEMANTIC_ICON.commission,
          visible: can("commissions.view"),
        },
        {
          href: "/admin/settings/outcomes-contracts",
          label: "Fee-at-risk contracts",
          blurb: "Review HMO/corporate-proposed fee-at-risk terms before they go live",
          icon: SEMANTIC_ICON.commission,
          visible: can("commissions.view"),
        },
      ],
    },
    {
      label: "Clinical configuration",
      tiles: [
        {
          href: "/admin/settings/protocols",
          label: "Clinical protocols",
          blurb: "The signed record behind every doctor-reviewed claim",
          icon: SEMANTIC_ICON.preventive,
          visible: can("protocols.manage"),
        },
        {
          href: "/admin/settings/cv-risk-config",
          label: "CV-risk configuration",
          blurb: "Lipid targets and cardiovascular-risk thresholds",
          icon: SEMANTIC_ICON.bp,
          visible: can("protocols.manage"),
        },
        {
          href: "/admin/settings/risk-questionnaire-config",
          label: "Risk questionnaire configuration",
          blurb: "The prevention risk assessment's questions and scoring rules",
          icon: SEMANTIC_ICON.preventive,
          visible: can("protocols.manage"),
        },
        {
          href: "/admin/settings/prevention-campaigns",
          label: "Prevention campaigns",
          blurb: "Time-boxed population health initiatives, e.g. Heart Health Month",
          icon: SEMANTIC_ICON.preventive,
          visible: can("protocols.manage"),
        },
        {
          // The §37 Symptom Assessment & Triage Engine's admin page
          // (packages/symptom-triage-engine, PR #345) shipped with no nav
          // entry anywhere -- this points here rather than to a second,
          // parallel triage-protocol admin surface (see the 2026-09-02
          // PR #376 reconciliation note in the ai-coach merge history for
          // why only one symptom-triage implementation was kept).
          href: "/admin/settings/triage-protocols",
          label: "Symptom triage protocol",
          blurb: "The decision tree behind the patient symptom checker",
          icon: SEMANTIC_ICON.preventive,
          visible: can("protocols.manage"),
        },
        {
          href: "/admin/settings/lpe-content-library",
          label: "Lifestyle coaching content",
          blurb: "The AI Coach's reference material, draft until a Clinical Director signs it off",
          icon: SEMANTIC_ICON.learn,
          visible: can("protocols.manage"),
        },
        {
          href: "/admin/settings/conditions",
          label: "Chronic conditions",
          blurb: "The phased chronic-disease catalogue",
          icon: SEMANTIC_ICON.carePlan,
          visible: can("conditions.manage"),
        },
        {
          href: "/admin/settings/health-education",
          label: "Health education library",
          blurb: "The clinician-reviewed learning catalogue",
          icon: NAV_ICON.ledger,
          visible: can("health_education.manage"),
        },
        {
          href: "/admin/settings/vitals-reminders",
          label: "Vitals reminder cadence",
          blurb: "How often patients are nudged to log vitals",
          icon: NAV_ICON.bell,
          visible: isSuperAdmin,
        },
        {
          href: "/admin/settings/medication-refills",
          label: "Medication refill reminders",
          blurb: "Days before a refill date patients get reminded",
          icon: SEMANTIC_ICON.medication,
          visible: isSuperAdmin,
        },
        {
          href: "/admin/settings/ai-coach",
          label: "AI Health Coach",
          blurb: "Internal testing, ahead of patient release",
          icon: SEMANTIC_ICON.aiCoach,
          visible: isSuperAdmin,
        },
      ],
    },
    {
      label: "Commerce & bookings",
      tiles: [
        {
          href: "/admin/settings/subscriptions",
          label: "Retired subscription catalogue",
          blurb: "Read-only history of the plans and add-ons retired in 2026",
          icon: SEMANTIC_ICON.billing,
          visible: can("subscriptions.manage"),
        },
        {
          href: "/admin/bookings",
          label: "Booking requests",
          blurb: "Every facility booking request and its status",
          icon: SEMANTIC_ICON.booking,
          visible: isSuperAdmin,
        },
        {
          href: "/admin/refund-requests",
          label: "Refund requests",
          blurb: "First-purchase money-back guarantee claims awaiting a decision",
          icon: SEMANTIC_ICON.billing,
          visible: isSuperAdmin,
        },
      ],
    },
    {
      label: "Platform & growth",
      tiles: [
        {
          href: "/analytics",
          label: "Platform analytics",
          blurb: "Business, financial, and population-health intelligence",
          icon: NAV_ICON.analytics,
          visible: canViewAnalytics,
        },
        {
          href: "/admin/settings/impact-metrics",
          label: "Public impact dashboard",
          blurb: "What shows on the public /impact page",
          icon: SEMANTIC_ICON.impact,
          visible: can("impact_metrics.manage"),
        },
        {
          href: "/admin/settings/service-regions",
          label: "Service regions",
          blurb: "Turn TarragonHealth on, one state at a time",
          icon: NAV_ICON.region,
          visible: can("service_regions.manage"),
        },
        {
          href: "/admin/settings/broadcasts",
          label: "Broadcasts & announcements",
          blurb: "Email and in-app announcements to a targeted audience",
          icon: NAV_ICON.broadcast,
          visible: can("broadcasts.send"),
        },
        {
          href: "/admin/settings/notification-templates",
          label: "Notification templates",
          blurb: "The catalogue of every notification the platform sends",
          icon: NAV_ICON.messages,
          visible: can("notification_templates.manage"),
        },
        {
          href: "/admin/settings/integrations",
          label: "API keys & integrations",
          blurb: "Inbound partner keys and outbound partner APIs",
          icon: SEMANTIC_ICON.family,
          visible: can("integrations.manage"),
        },
        {
          href: "/admin/settings/protocol-api",
          label: "Protocol API",
          blurb: "License escalation/risk/protocol machinery to partners",
          icon: NAV_ICON.settings,
          visible: can("integrations.manage"),
        },
        {
          href: "/admin/settings/ai-governance",
          label: "AI governance",
          blurb: "Every AI system's incidents and kill switch",
          icon: SEMANTIC_ICON.aiCoach,
          visible: can("ai_governance.manage"),
        },
        {
          href: "/admin/testimonials",
          label: "Testimonials",
          blurb: "Review consented patient quotes before they go live",
          icon: NAV_ICON.review,
          visible: isSuperAdmin,
        },
        {
          href: "/admin/doctor-testimonials",
          label: "Doctor testimonials",
          blurb: "Add and publish a doctor's quote, with its off-platform consent on file",
          icon: NAV_ICON.review,
          visible: isSuperAdmin,
        },
        {
          href: "/admin/settings/platform-modules",
          label: "Platform modules",
          blurb: "Activate the payer or provider-organisation platform",
          icon: NAV_ICON.settings,
          visible: isSuperAdmin,
        },
        {
          href: "/admin/settings/ngo-programmes",
          label: "NGO-funded programmes",
          blurb: "Create a funded cohort for a signed NGO/PHC partner",
          icon: SEMANTIC_ICON.corporate,
          visible: isSuperAdmin,
        },
      ],
    },
    {
      label: "Operations & governance",
      tiles: [
        {
          href: "/admin/ops",
          label: "Operations console",
          blurb: "Tarragon Today, one exception queue across every domain, system health",
          icon: NAV_ICON.operations,
          visible: canViewOps,
        },
        {
          href: "/admin/ops/incidents",
          label: "Incident register",
          blurb: "Clinical, technical, privacy, security, financial and operational incidents",
          icon: NAV_ICON.siren,
          visible: canViewIncidents,
        },
        {
          href: "/admin/settings/feature-flags",
          label: "Feature flags",
          blurb: "Roll a feature out by staff, state, role, organisation, or percentage — no deploy",
          icon: NAV_ICON.flag,
          visible: can("feature_flags.manage"),
        },
      ],
    },
  ]
    .map((group) => ({ ...group, tiles: group.tiles.filter((tile) => tile.visible) }))
    .filter((group) => group.tiles.length > 0);

  return (
    <div className="space-y-6">
      <OpenAdminSearchBar />
      <div className="flex flex-col gap-4 rounded-2xl bg-gradient-to-br from-clinical-navy to-brand-green p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <h1 className="font-heading text-2xl font-semibold sm:text-3xl">
            Welcome back{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-white/80">Here is what needs you, most urgent first.</p>
        </div>
        {canViewAnalytics && (
          <Link
            href="/analytics"
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-clinical-navy transition-colors hover:bg-white/90"
          >
            View analytics
          </Link>
        )}
      </div>

      {downDependencies.length > 0 && (
        <LoadFailure>
          {downDependencies.map((k) => DEPENDENCY_LABELS[k as keyof typeof DEPENDENCY_LABELS] ?? k).join(", ")}{" "}
          {downDependencies.length === 1 ? "is" : "are"} reporting down. See System status at the bottom of this page.
        </LoadFailure>
      )}

      <AttentionHero view={attention} />

      {/* Unlike the clinician worklist strip, this one degrades per tile
          rather than replacing the whole row: these four figures come from
          four independent reads, and blanking three that loaded correctly to
          report one that didn't would throw away more truth than it saves.
          A failed tile shows StatTile's muted `empty` hint and drops its
          delta line, so no number and no comparison is invented; the notice
          below names which ones are missing. */}
      {failedTiles.length > 0 && (
        <LoadFailure>
          The {joinLabels(failedTiles)} on this page could not be loaded. Those tiles show no
          figure rather than a zero, and nothing here should be read as a platform total. Reload
          to try again.
        </LoadFailure>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/admin/patients/directory"
          className="block rounded-xl transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
        >
        <StatTile
          icon={SEMANTIC_ICON.parentCare}
          label="Total patients"
          {...(patientsFailed
            ? { empty: { hint: "Could not be loaded" } }
            : {
                value: formatNumber(business.total_patients),
                delta: {
                  text: `${formatNumber(business.active_patients)} active`,
                  direction: "flat" as const,
                },
              })}
        />
        </Link>
        <StatTile
          icon={SEMANTIC_ICON.clinicianFollowUp}
          label="Active clinicians"
          {...(cliniciansFailed
            ? { empty: { hint: "Could not be loaded" } }
            : {
                value: formatNumber(activeClinicianCount),
                delta: {
                  text: `${formatNumber(pendingVerificationCount)} pending verification`,
                  direction: "flat" as const,
                },
              })}
        />
        <StatTile
          icon={SEMANTIC_ICON.billing}
          label="Revenue (90 days)"
          {...(revenueFailed
            ? { empty: { hint: "Could not be loaded" } }
            : {
                value: revenue90dDisplay,
                delta: {
                  text: `${formatNumber(financial.paid_purchases)} paid service${financial.paid_purchases === 1 ? "" : "s"}`,
                  direction: "flat" as const,
                },
              })}
        />
        <StatTile
          icon={SEMANTIC_ICON.booking}
          label="Open bookings"
          {...(bookingsFailed
            ? { empty: { hint: "Could not be loaded" } }
            : {
                value: formatNumber(openBookingsCount),
                delta: {
                  text: `${formatNumber(pendingBookingsCount)} awaiting review`,
                  direction: "flat" as const,
                },
              })}
        />
      </div>

      {/* Every area is still here, grouped as before; each group opens on a tap so the page leads with the work, not ~60 squares.
          Native details/summary: works without script and is keyboard-accessible. The search bar above reaches any page by name. */}
      <section aria-label="All areas" className="space-y-3">
        {groups.map((group) => (
          <details key={group.label} className="group/section rounded-2xl border border-charcoal-ink/10 bg-white dark:border-night-ink/15 dark:bg-night-card">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-heading text-sm font-medium text-charcoal-ink dark:text-night-ink">
              <span>{group.label}</span>
              <span className="flex items-center gap-2 text-xs font-normal text-charcoal-ink/60 dark:text-night-ink/60">
                {group.tiles.length}
                <span aria-hidden>▾</span>
              </span>
            </summary>
            <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-3 lg:grid-cols-4">
              {group.tiles.map((tile) => (
                <Link
                  key={tile.href}
                  href={tile.href}
                  title={tile.blurb}
                  className="group mx-auto flex aspect-square w-full max-w-[168px] flex-col items-center justify-center gap-2 rounded-2xl border border-charcoal-ink/10 bg-white p-4 text-center shadow-sm transition-all hover:border-brand-green/40 hover:shadow-md"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-soft-sage">
                    <tile.icon className="h-5 w-5 text-deep-forest" strokeWidth={2} />
                  </span>
                  <span className="line-clamp-2 text-xs font-medium leading-snug text-charcoal-ink group-hover:text-deep-forest sm:text-sm">
                    {tile.label}
                  </span>
                </Link>
              ))}
            </div>
          </details>
        ))}
      </section>

      <Card variant="soft">
        <CardHeader>
          <CardTitle>System status</CardTitle>
          <CardDescription>
            Live dependency checks, also reachable unauthenticated at{" "}
            <code className="text-xs">/api/status</code>, see{" "}
            <code className="text-xs">docs/BUSINESS_CONTINUITY_DR_SPEC.md</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            {(Object.keys(DEPENDENCY_LABELS) as Array<keyof typeof DEPENDENCY_LABELS>).map(
              (key) => (
                <li key={key} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-charcoal-ink/80">{DEPENDENCY_LABELS[key]}</span>
                  <Badge variant={statusBadgeVariant(dependencyReport[key].status)}>
                    {dependencyReport[key].status}
                  </Badge>
                </li>
              )
            )}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

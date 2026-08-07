import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { DashboardPlaceholder } from "@/components/dashboard-placeholder";
import { SEMANTIC_ICON, NAV_ICON } from "@/lib/icons";

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

function sectionId(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

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
          href: "/admin/leads",
          label: "Leads",
          blurb: "Contact form and plan-finder submissions, including B2B",
          icon: NAV_ICON.inbox,
          visible: can("leads.manage"),
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
          label: "Subscription plans & add-ons",
          blurb: "Create, price, and activate plans, synced to Paystack",
          icon: SEMANTIC_ICON.billing,
          visible: can("subscriptions.manage"),
        },
        {
          href: "/admin/settings/diaspora-pricing",
          label: "Diaspora pricing (USD)",
          blurb: "USD pricing at the admin-set exchange rate",
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
          blurb: "Email/WhatsApp/SMS to a targeted audience",
          icon: NAV_ICON.broadcast,
          visible: can("broadcasts.send"),
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
          href: "/admin/testimonials",
          label: "Testimonials",
          blurb: "Review consented patient quotes before they go live",
          icon: NAV_ICON.review,
          visible: isSuperAdmin,
        },
      ],
    },
  ]
    .map((group) => ({ ...group, tiles: group.tiles.filter((tile) => tile.visible) }))
    .filter((group) => group.tiles.length > 0);

  return (
    <DashboardPlaceholder
      greeting={`Welcome${profile?.full_name ? `, ${profile.full_name}` : ""}`}
      roleLabel={isSuperAdmin ? "Super Admin" : "Admin"}
      comingUp={[
        "Users, orgs, system health (API latency, WhatsApp delivery, ML status)",
        "Finance: MRR/ARR/churn/commission/receivables",
        "ML model versioning + batch re-scoring trigger",
        "Audit trail + NDPR export/erasure tools",
      ]}
    >
      {groups.map((group) => (
        <section key={group.label} aria-labelledby={`${sectionId(group.label)}-heading`} className="space-y-3">
          <h2
            id={`${sectionId(group.label)}-heading`}
            className="font-heading text-sm font-medium text-charcoal-ink/60"
          >
            {group.label}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
        </section>
      ))}
    </DashboardPlaceholder>
  );
}

import type { AppIconName } from "@/lib/icons";

/** One sidebar link. `exact` marks role-root dashboards so `/patient` doesn't
 * light up while the user is on `/patient/family`. */
export interface NavItem {
  label: string;
  href: string;
  icon: AppIconName;
  exact?: boolean;
}

/** A labelled group of sidebar links. `label` is omitted for the top group. */
export interface NavSection {
  label?: string;
  items: NavItem[];
}

/** Role → sidebar navigation. Routes listed here must be real pages; pages
 * that gate on entitlement/permission still render a friendly gate, so a
 * link is safe even when the caller lacks the feature. */
export function getNavSections(role: string | null | undefined): NavSection[] {
  switch (role) {
    case "patient":
      return [
        {
          items: [
            { label: "Dashboard", href: "/patient", icon: "dashboard", exact: true },
            { label: "Health Passport", href: "/patient/health-passport", icon: "passport" },
            { label: "Lifestyle coaching", href: "/patient/lifestyle", icon: "lifestyle" },
            { label: "Family plan", href: "/patient/family", icon: "family" },
            { label: "ParentCare", href: "/patient/parentcare", icon: "parentCare" },
            { label: "Subscription", href: "/patient/subscription", icon: "billing" },
          ],
        },
      ];
    case "clinician":
    case "care_coordinator":
      // Care Coordinators share the clinician surfaces they can act on
      // (logistics-only work: orders, bookings, inboxes); clinical judgment
      // pages self-gate server-side.
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
                { label: "Outreach", href: "/clinician/outreach", icon: "messages" },
                { label: "Orders", href: "/clinician/orders", icon: "logistics" },
                { label: "Support inbox", href: "/clinician/support-inbox", icon: "inbox" },
              ],
            },
          ]
        : [
            {
              items: [
                { label: "Dashboard", href: "/clinician", icon: "dashboard", exact: true },
                { label: "Patients", href: "/clinician/patients", icon: "parentCare" },
              ],
            },
            {
              label: "Worklists",
              items: [
                { label: "Escalations", href: "/clinician/escalations", icon: "escalation" },
                { label: "Outreach", href: "/clinician/outreach", icon: "messages" },
                { label: "Async consults", href: "/clinician/async-consults", icon: "inbox" },
                { label: "Availability", href: "/clinician/availability", icon: "booking" },
                { label: "Orders", href: "/clinician/orders", icon: "logistics" },
                { label: "Referrals", href: "/clinician/referrals", icon: "referral" },
                { label: "Adherence alerts", href: "/clinician/adherence", icon: "medication" },
                { label: "Recommendations", href: "/clinician/recommendations", icon: "carePlan" },
                { label: "Vaccinations", href: "/clinician/vaccinations", icon: "vaccination" },
                { label: "Lifestyle flags", href: "/clinician/lifestyle-flags", icon: "lifestyle" },
              ],
            },
            {
              label: "Reviews",
              items: [
                { label: "Medication reviews", href: "/clinician/medication-reviews", icon: "medication" },
                { label: "Annual reviews", href: "/clinician/annual-reviews", icon: "review" },
                { label: "Preventive reviews", href: "/clinician/preventive-reviews", icon: "preventive" },
                { label: "Lifestyle reviews", href: "/clinician/lifestyle-reviews", icon: "lifestyle" },
                { label: "Care plan review", href: "/clinician/care-plan-review", icon: "carePlan" },
                { label: "Diabetes quality", href: "/clinician/diabetes-quality", icon: "diabetes" },
              ],
            },
            {
              label: "Messaging",
              items: [
                { label: "Patient messages", href: "/clinician/messages", icon: "messages" },
                { label: "Support inbox", href: "/clinician/support-inbox", icon: "inbox" },
              ],
            },
          ];
    case "doctor":
      return [
        {
          items: [
            { label: "Dashboard", href: "/doctor", icon: "dashboard", exact: true },
            { label: "Escalations", href: "/doctor/escalations", icon: "escalation" },
            { label: "Referrals", href: "/doctor/referrals", icon: "referral" },
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
          ],
        },
      ];
    case "pharmacist":
      return [
        {
          items: [
            { label: "Dashboard", href: "/pharmacist", icon: "dashboard", exact: true },
          ],
        },
      ];
    case "analyst":
      return [
        {
          items: [
            { label: "Analytics console", href: "/analytics", icon: "analytics", exact: true },
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

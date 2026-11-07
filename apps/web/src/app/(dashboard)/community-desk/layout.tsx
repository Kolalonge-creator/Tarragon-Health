import { Suspense } from "react";
import { getCommunityStaffContext } from "@/components/community/staff-rpc";
import { DeskNav, type DeskNavItem } from "./desk-nav";

export const dynamic = "force-dynamic";

/**
 * The shared Community desk (decision COM-31, 2026-11-07): one address for every staff member an administrator has given a moderation
 * role, whatever their account role. This path sits outside every role home, so the proxy lets any signed-in account reach it; the
 * door is this check (community_staff_context().has_desk), and every RPC behind the pages checks the grant again in the database.
 */
export default async function CommunityDeskLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCommunityStaffContext();

  if (!ctx || !ctx.has_desk) {
    return (
      <section className="mx-auto max-w-xl rounded-xl border border-charcoal-ink/10 bg-white p-6 dark:border-night-ink/15 dark:bg-night-card">
        <h1 className="font-heading text-xl font-semibold text-charcoal-ink dark:text-night-ink">Community desk</h1>
        <p className="mt-2 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          {ctx
            ? "This desk is for staff who have been given a Community role (moderator, senior moderator or safety reviewer). An administrator gives these roles. If you think you should have one, ask your administrator."
            : "We could not check your Community role just now. Please reload the page in a moment."}
        </p>
      </section>
    );
  }

  const roles = [
    ctx.is_admin && "Administrator",
    ctx.is_cmo && "Chief Medical Officer",
    ctx.is_senior_moderator ? "Senior moderator" : ctx.is_moderator && "Moderator",
    ctx.is_safety_reviewer && "Safety reviewer",
  ].filter((r): r is string => typeof r === "string");

  // Only sections that exist and that this person may open. Configuration pages that still live in the admin or CMO area are linked
  // only for those people (a moderator would be bounced by the proxy).
  const items: DeskNavItem[] = [
    { label: "Overview", href: "/community-desk", exact: true },
    ...(ctx.is_moderator || ctx.is_safety_reviewer ? [{ label: "Moderation worklist", href: "/community-desk/queue" }] : []),
    ...(ctx.is_safety_reviewer ? [{ label: "Safety", href: "/community-desk/queue?tab=safety", matchTab: "safety" }] : []),
    ...(ctx.is_admin
      ? [
          { label: "Groups", href: "/admin/community/groups", external: true },
          { label: "Moderators", href: "/admin/community/staff", external: true },
          { label: "Rota", href: "/admin/community/rota", external: true },
          { label: "Safety drills", href: "/admin/community/drill", external: true },
          { label: "Filter rules", href: "/admin/community/rules", external: true },
        ]
      : ctx.is_cmo
        ? [
            { label: "Rules and sign-off", href: "/clinician/community", external: true },
            { label: "Safety drills", href: "/clinician/community/drill", external: true },
          ]
        : []),
  ];

  return (
    <div className="space-y-5">
      <header className="rounded-xl bg-clinical-navy px-5 py-4 text-white">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-white/70">Community</p>
            <h1 className="font-heading text-xl font-semibold">Community desk</h1>
          </div>
          <p className="text-sm text-white/80">
            <span className="sr-only">Your roles: </span>
            {roles.join(" · ")}
          </p>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-white/75">
          The shared space for everyone with a Community role. Members are shown only by their community name; who a person is stays
          hidden unless the recorded member lookup is used.
        </p>
      </header>
      {/* the menu reads the URL in the browser to mark the current section */}
      <Suspense fallback={null}>
        <DeskNav items={items} />
      </Suspense>
      <div>{children}</div>
    </div>
  );
}

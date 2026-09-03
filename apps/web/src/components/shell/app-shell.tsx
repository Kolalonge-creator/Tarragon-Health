"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ICON, APP_ICON } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "./notification-bell";
import { PushSubscribePrompt } from "./push-subscribe-prompt";
import { DeviceHeartbeat } from "./device-heartbeat";
import { ProfileMenu } from "./profile-menu";
import { Avatar } from "@/components/avatar";
import { MAX_PRIMARY_NAV_ITEMS, type NavItem, type NavSection } from "@/lib/navigation";
import { useWorklistCounts, type WorklistCountKey } from "@/lib/queries/worklist-counts";

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The phone bottom tab bar — the everyday links within thumb reach, so a
 * patient on a phone isn't opening the hamburger drawer to do the two or
 * three things they came to do. Driven entirely by `primary` on the nav
 * config, so each role decides its own tabs (and a role that flags nothing
 * keeps the drawer-only behaviour it had before). "More" opens the same full
 * drawer, so nothing here removes a route from reach — this is a shortcut
 * layer over the sidebar, not a second, smaller menu.
 */
function BottomTabBar({
  items,
  pathname,
  showMore,
  onMore,
}: {
  items: NavItem[];
  pathname: string;
  showMore: boolean;
  onMore: () => void;
}) {
  const tabClass =
    "flex flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium leading-tight";

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-charcoal-ink/10 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden print:hidden"
    >
      <ul className="flex items-stretch">
        {items.map((item) => {
          const active = isActive(pathname, item.href, item.exact);
          const Icon = APP_ICON[item.icon];
          return (
            <li key={item.href} className="flex flex-1">
              <Link
                href={item.href}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  tabClass,
                  active ? "text-deep-forest" : "text-charcoal-ink/55"
                )}
              >
                <Icon
                  className={cn("h-5 w-5", active ? "text-brand-green" : "text-charcoal-ink/45")}
                  strokeWidth={2}
                />
                <span className="truncate">{item.shortLabel ?? item.label}</span>
              </Link>
            </li>
          );
        })}
        {showMore && (
          <li className="flex flex-1">
            <button
              type="button"
              onClick={onMore}
              aria-label="Open menu"
              className={cn(tabClass, "text-charcoal-ink/55")}
            >
              <NAV_ICON.menu className="h-5 w-5 text-charcoal-ink/45" strokeWidth={2} />
              <span>More</span>
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}

/** A live open-item count next to a nav link (see NavItem.countKey) — hidden
 * at zero so a persistent, always-on-screen sidebar doesn't turn into a wall
 * of "0" pills the way a one-time dashboard summary safely can. */
function NavBadge({ count }: { count: number | undefined }) {
  if (!count) return null;
  return (
    <span className="ml-auto shrink-0 rounded-full bg-brand-green/15 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-deep-forest">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function SidebarNav({
  sections,
  pathname,
  onNavigate,
}: {
  sections: NavSection[];
  pathname: string;
  onNavigate?: () => void;
}) {
  const countKeys = React.useMemo(
    () =>
      Array.from(
        new Set(
          sections.flatMap((s) => s.items.map((i) => i.countKey)).filter((k): k is WorklistCountKey => !!k)
        )
      ),
    [sections]
  );
  const { data: counts } = useWorklistCounts(countKeys);

  return (
    <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {sections.map((section, i) => (
        <div key={section.label ?? i}>
          {section.label && (
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-charcoal-ink/40">
              {section.label}
            </p>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href, item.exact);
              const Icon = APP_ICON[item.icon];
              const danger = item.variant === "danger";
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    prefetch={false}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      danger
                        ? "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                        : active
                          ? "bg-brand-green/10 text-deep-forest"
                          : "text-charcoal-ink/70 hover:bg-charcoal-ink/5 hover:text-charcoal-ink"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4.5 w-4.5 shrink-0",
                        danger
                          ? "text-red-600"
                          : active
                            ? "text-brand-green"
                            : "text-charcoal-ink/40 group-hover:text-charcoal-ink/60"
                      )}
                      strokeWidth={2}
                    />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.countKey && <NavBadge count={counts?.[item.countKey]} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function BrandLockup({ homeHref }: { homeHref: string }) {
  // Links to the caller's role home, not "/" — on hosts without the app.
  // subdomain (e.g. the bare Vercel domain) "/" is the marketing homepage,
  // and the logo must never bounce a signed-in user out of the platform.
  return (
    <Link href={homeHref} className="flex items-center gap-2.5 px-5 py-5">
      <Image
        src="/brand/guard-leaf-mark.png"
        alt=""
        width={28}
        height={28}
        className="h-7 w-7"
        priority
      />
      <span className="font-heading text-lg font-semibold tracking-tight text-deep-forest">
        TarragonHealth
      </span>
    </Link>
  );
}

export function AppShell({
  userName,
  avatarUrl,
  roleLabel,
  idLabel,
  idValue,
  profileHref,
  navSections,
  signOutAction,
  children,
}: {
  userName: string;
  avatarUrl?: string | null;
  roleLabel: string;
  /** e.g. "Patient ID" / "Staff ID" — omitted for roles with no reference number. */
  idLabel?: string;
  idValue?: string | null;
  /** Where the profile menu's "Profile & settings" link and the sidebar
   * user block both point — role-dependent, computed by the caller. */
  profileHref: string;
  navSections: NavSection[];
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // Close the drawer whenever the route changes (state-adjust-during-render
  // pattern — drawer links also close on click; this catches back/forward).
  const [prevPathname, setPrevPathname] = React.useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setMobileOpen(false);
  }

  const hasNav = navSections.some((s) => s.items.length > 0);
  const homeHref = navSections[0]?.items[0]?.href ?? "/login";
  const allItems = navSections.flatMap((s) => s.items);
  const primaryItems = allItems.filter((item) => item.primary).slice(0, MAX_PRIMARY_NAV_ITEMS);
  // No More button when the tabs already cover every link — a supporter's
  // four-link menu would otherwise get a button opening a drawer that shows
  // them nothing new.
  const showBottomBar = primaryItems.length > 0;
  const showMoreTab = allItems.length > primaryItems.length;

  const userBlock = (
    <div className="space-y-3 border-t border-charcoal-ink/10 px-4 py-4">
      <Link href={profileHref} className="flex items-center gap-3 rounded-lg hover:bg-charcoal-ink/5">
        <Avatar fullName={userName} photoUrl={avatarUrl} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-charcoal-ink">{userName}</p>
          <p className="truncate text-xs text-charcoal-ink/50">{roleLabel}</p>
        </div>
      </Link>
      <form action={signOutAction}>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="w-full justify-center gap-2 text-charcoal-ink/70 hover:text-charcoal-ink"
        >
          <NAV_ICON.signOut className="h-4 w-4" strokeWidth={2} />
          Sign out
        </Button>
      </form>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-white print:block print:min-h-0">
      {/* Desktop sidebar */}
      {hasNav && (
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-charcoal-ink/10 bg-white lg:flex print:hidden">
          <BrandLockup homeHref={homeHref} />
          <SidebarNav sections={navSections} pathname={pathname} />
          {userBlock}
        </aside>
      )}

      {/* Mobile drawer */}
      {hasNav && mobileOpen && (
        <div className="fixed inset-0 z-50 print:hidden lg:hidden" role="dialog" aria-modal="true">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-charcoal-ink/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between pr-3">
              <BrandLockup homeHref={homeHref} />
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0"
                aria-label="Close menu"
                onClick={() => setMobileOpen(false)}
              >
                <NAV_ICON.close className="h-5 w-5" strokeWidth={2} />
              </Button>
            </div>
            <SidebarNav
              sections={navSections}
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
            />
            {userBlock}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col print:block">
        <header className="sticky top-0 z-40 border-b border-charcoal-ink/10 bg-white/90 backdrop-blur print:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              {hasNav && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 p-0 lg:hidden"
                  aria-label="Open menu"
                  onClick={() => setMobileOpen(true)}
                >
                  <NAV_ICON.menu className="h-5 w-5" strokeWidth={2} />
                </Button>
              )}
              <span
                className={cn(
                  "font-heading text-base font-semibold text-deep-forest",
                  hasNav && "lg:hidden"
                )}
              >
                TarragonHealth
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <DeviceHeartbeat />
              <PushSubscribePrompt />
              <NotificationBell />
              <ProfileMenu
                userName={userName}
                avatarUrl={avatarUrl}
                roleLabel={roleLabel}
                idLabel={idLabel}
                idValue={idValue}
                profileHref={profileHref}
                signOutAction={signOutAction}
              />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 print:max-w-none print:p-0">
          {children}
        </main>
        <footer
          className={cn(
            "px-4 pb-6 text-center text-xs text-charcoal-ink/40 sm:px-6 print:hidden",
            // Clears the fixed bottom bar so the last of the page is never
            // sitting underneath it.
            showBottomBar && "pb-24 lg:pb-6"
          )}
        >
          TarragonHealth: Care that stays with you.
        </footer>
      </div>

      {hasNav && showBottomBar && (
        <BottomTabBar
          items={primaryItems}
          pathname={pathname}
          showMore={showMoreTab}
          onMore={() => setMobileOpen(true)}
        />
      )}
    </div>
  );
}

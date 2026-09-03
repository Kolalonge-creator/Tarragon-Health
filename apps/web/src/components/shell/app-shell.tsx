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
import { ThemeToggle, type ThemePreference } from "./theme-toggle";
import { Avatar } from "@/components/avatar";
import { MAX_PRIMARY_NAV_ITEMS, type NavItem, type NavSection } from "@/lib/navigation";

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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-charcoal-ink/10 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden print:hidden dark:border-night-ink/15 dark:bg-night-ground/95"
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
                  active
                    ? "text-deep-forest dark:text-brand-green-bright"
                    : "text-charcoal-ink/55 dark:text-night-ink/60"
                )}
              >
                <Icon
                  className={cn(
                    "h-5 w-5",
                    active
                      ? "text-brand-green dark:text-brand-green-bright"
                      : "text-charcoal-ink/45 dark:text-night-ink/55"
                  )}
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
              className={cn(tabClass, "text-charcoal-ink/55 dark:text-night-ink/60")}
            >
              <NAV_ICON.menu
                className="h-5 w-5 text-charcoal-ink/45 dark:text-night-ink/55"
                strokeWidth={2}
              />
              <span>More</span>
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}

function NavLinkItem({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = isActive(pathname, item.href, item.exact);
  const Icon = APP_ICON[item.icon];
  const danger = item.variant === "danger";
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        prefetch={false}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          danger
            ? "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25"
            : active
              ? "bg-brand-green/10 text-deep-forest dark:text-brand-green-bright"
              : "text-charcoal-ink/70 hover:bg-charcoal-ink/5 hover:text-charcoal-ink dark:text-night-ink/70 dark:hover:bg-night-ink/10 dark:hover:text-night-ink"
        )}
      >
        <Icon
          className={cn(
            "h-4.5 w-4.5 shrink-0",
            danger
              ? "text-red-600 dark:text-red-400"
              : active
                ? "text-brand-green dark:text-brand-green-bright"
                : "text-charcoal-ink/40 group-hover:text-charcoal-ink/60 dark:text-night-ink/50 dark:group-hover:text-night-ink/60"
          )}
          strokeWidth={2}
        />
        <span className="truncate">{item.label}</span>
      </Link>
    </li>
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
  return (
    <nav aria-label="Main" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {sections.map((section, i) => (
        <div key={section.label ?? i}>
          {section.label && (
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-charcoal-ink/40 dark:text-night-ink/50">
              {section.label}
            </p>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <NavLinkItem key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Which manually-opened sidebar groups to remember between visits. Reads and
 * writes are wrapped in try/catch — private windows and cleared site data must
 * degrade to the defaults, never to a crash. */
const OPEN_GROUPS_STORAGE_KEY = "nav-open-groups-v1";

// localStorage plumbing for useSyncExternalStore: the raw string is the
// snapshot (referentially stable between writes), the server snapshot is
// null so SSR and hydration agree, and subscribing to the storage event
// keeps two open tabs consistent for free.
function subscribeToStorage(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

function getStoredOpenGroupsRaw(): string | null {
  try {
    return window.localStorage.getItem(OPEN_GROUPS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function getServerOpenGroupsRaw(): string | null {
  return null;
}

function CollapsibleNavGroup({
  label,
  items,
  pathname,
  open,
  onToggle,
}: {
  label: string;
  items: NavItem[];
  pathname: string;
  open: boolean;
  onToggle: (label: string, currentlyOpen: boolean) => void;
}) {
  const panelId = React.useId();
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onToggle(label, open)}
        className="flex w-full items-center justify-between rounded-lg px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-charcoal-ink/40 transition-colors hover:text-charcoal-ink/70 dark:text-night-ink/50 dark:hover:text-night-ink/70"
      >
        {label}
        <NAV_ICON.chevronRight
          aria-hidden="true"
          className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-90")}
          strokeWidth={2}
        />
      </button>
      <div
        id={panelId}
        className={cn(
          "grid transition-[grid-template-rows] duration-200",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        {/* `inert` keeps collapsed links out of the tab order and the
            accessibility tree while grid-template-rows animates the height. */}
        <div className="overflow-hidden" inert={!open}>
          <ul className="space-y-0.5">
            {items.map((item) => (
              <NavLinkItem key={item.href} item={item} pathname={pathname} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * Progressive-disclosure variant of SidebarNav for the desktop patient
 * sidebar (the patient menu is ~30 links across five groups — expanded, it
 * reads like an admin panel). Labelled groups collapse to their headings;
 * only the group holding the current route opens by default, manual opens
 * persist in localStorage, and navigation re-opens the group it lands in.
 * SAFETY EXCEPTION: any `variant: "danger"` link (the Emergency card) is
 * hoisted out of its group at render and pinned always-visible at the bottom
 * of the nav — a safety link must never sit behind a collapsed heading.
 * Staff roles keep the always-expanded SidebarNav above, and the phone
 * drawer stays fully expanded too (it is already disclosure-on-demand).
 */
function CollapsibleSidebarNav({
  sections,
  pathname,
}: {
  sections: NavSection[];
  pathname: string;
}) {
  const dangerItems = sections.flatMap((s) => s.items.filter((i) => i.variant === "danger"));
  const groups = sections
    .map((s) => ({ label: s.label, items: s.items.filter((i) => i.variant !== "danger") }))
    .filter((g) => g.items.length > 0);
  const activeGroupLabel = groups.find((g) =>
    g.items.some((i) => isActive(pathname, i.href, i.exact))
  )?.label;

  // Manual overrides on top of the "only the active group is open" default:
  // true = opened by hand, false = collapsed by hand (session-local; only
  // opens persist). Previously-persisted opens arrive through
  // useSyncExternalStore, which renders the server snapshot (nothing stored)
  // during hydration and re-reads on the client — no hydration mismatch.
  const [manualOpen, setManualOpen] = React.useState<Record<string, boolean>>({});
  const storedRaw = React.useSyncExternalStore(
    subscribeToStorage,
    getStoredOpenGroupsRaw,
    getServerOpenGroupsRaw
  );
  const storedOpen = React.useMemo<Record<string, boolean>>(() => {
    if (!storedRaw) return {};
    try {
      const parsed: unknown = JSON.parse(storedRaw);
      if (!Array.isArray(parsed)) return {};
      const stored: Record<string, boolean> = {};
      for (const label of parsed) {
        if (typeof label === "string") stored[label] = true;
      }
      return stored;
    } catch {
      // Corrupt value — defaults are fine.
      return {};
    }
  }, [storedRaw]);

  // This session's toggles win over what was persisted.
  const overrideFor = (label: string): boolean | undefined =>
    manualOpen[label] ?? (storedOpen[label] ? true : undefined);

  // Auto-open follows navigation: landing on a route clears any manual
  // collapse of the group that now holds it (state-adjust-during-render,
  // the same pattern the mobile drawer uses for closing on route change).
  const [prevPathname, setPrevPathname] = React.useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    if (activeGroupLabel && manualOpen[activeGroupLabel] === false) {
      const next = { ...manualOpen };
      delete next[activeGroupLabel];
      setManualOpen(next);
    }
  }

  const toggleGroup = (label: string, currentlyOpen: boolean) => {
    const next = { ...manualOpen, [label]: !currentlyOpen };
    setManualOpen(next);
    try {
      const persisted = new Set(Object.keys(storedOpen).filter((key) => storedOpen[key]));
      for (const [key, value] of Object.entries(next)) {
        if (value) persisted.add(key);
        else persisted.delete(key);
      }
      window.localStorage.setItem(OPEN_GROUPS_STORAGE_KEY, JSON.stringify([...persisted]));
    } catch {
      // Storage unavailable — this session still works, it just won't persist.
    }
  };

  return (
    <nav aria-label="Main" className="flex flex-1 flex-col overflow-y-auto px-3 py-4">
      <div className="space-y-6">
        {groups.map((group, i) =>
          group.label ? (
            <CollapsibleNavGroup
              key={group.label}
              label={group.label}
              items={group.items}
              pathname={pathname}
              open={overrideFor(group.label) ?? group.label === activeGroupLabel}
              onToggle={toggleGroup}
            />
          ) : (
            <ul key={i} className="space-y-0.5">
              {group.items.map((item) => (
                <NavLinkItem key={item.href} item={item} pathname={pathname} />
              ))}
            </ul>
          )
        )}
      </div>
      {dangerItems.length > 0 && (
        <ul className="mt-auto space-y-0.5 pt-6">
          {dangerItems.map((item) => (
            <NavLinkItem key={item.href} item={item} pathname={pathname} />
          ))}
        </ul>
      )}
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
      <span className="font-heading text-lg font-semibold tracking-tight text-deep-forest dark:text-brand-green-bright">
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
  surface = "default",
  initialTheme = "light",
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
  /** "warm" paints the content area on the Warm Ivory ground and switches
   * the desktop sidebar to progressive disclosure — the patient-facing
   * surface, matching the mobile app's warm screen background. Staff and
   * clinical consoles keep the default white canvas and the always-expanded
   * sidebar (per docs/BRAND_GUIDE.md §5). */
  surface?: "warm" | "default";
  /** Cookie-persisted theme preference (patient surface only). Server-read
   * so the data-theme attribute is on the first paint — no wrong-theme
   * flash. Ignored on the default surface, which never themes. */
  initialTheme?: ThemePreference;
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [theme, setTheme] = React.useState<ThemePreference>(initialTheme);

  // "system" resolves to a concrete dark/light here (the CSS variant only
  // matches data-theme="dark"). Server snapshot is false, so a dark-system
  // user gets one light first paint; an explicit dark choice never flashes
  // because the cookie renders the attribute server-side.
  const systemPrefersDark = React.useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false
  );
  const resolvedTheme: "light" | "dark" =
    theme === "system" ? (systemPrefersDark ? "dark" : "light") : theme;

  // Paper must always print ink-on-white: beforeprint flips the attribute
  // to light with a direct DOM write (a React state update may not flush
  // before the print snapshot), afterprint restores it.
  const themedRootRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = themedRootRef.current;
    if (!el || surface !== "warm") return;
    const toLight = () => el.setAttribute("data-theme", "light");
    const restore = () => el.setAttribute("data-theme", resolvedTheme);
    window.addEventListener("beforeprint", toLight);
    window.addEventListener("afterprint", restore);
    return () => {
      window.removeEventListener("beforeprint", toLight);
      window.removeEventListener("afterprint", restore);
    };
  }, [surface, resolvedTheme]);

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
    <div className="space-y-3 border-t border-charcoal-ink/10 px-4 py-4 dark:border-night-ink/15">
      <Link
        href={profileHref}
        className="flex items-center gap-3 rounded-lg hover:bg-charcoal-ink/5 dark:hover:bg-night-ink/10"
      >
        <Avatar fullName={userName} photoUrl={avatarUrl} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-charcoal-ink dark:text-night-ink">{userName}</p>
          <p className="truncate text-xs text-charcoal-ink/50 dark:text-night-ink/55">{roleLabel}</p>
        </div>
      </Link>
      <form action={signOutAction}>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="w-full justify-center gap-2 text-charcoal-ink/70 hover:text-charcoal-ink dark:text-night-ink/70 dark:hover:text-night-ink"
        >
          <NAV_ICON.signOut className="h-4 w-4" strokeWidth={2} />
          Sign out
        </Button>
      </form>
    </div>
  );

  return (
    <div
      ref={themedRootRef}
      // data-theme scopes every dark: variant to this subtree (globals.css'
      // Night theme block). Only the warm patient surface ever carries it;
      // staff consoles stay light regardless of any stored preference.
      data-theme={surface === "warm" ? resolvedTheme : undefined}
      className="flex min-h-screen bg-white print:block print:min-h-0 dark:bg-night-ground"
    >
      {/* Desktop sidebar */}
      {hasNav && (
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-charcoal-ink/10 bg-white lg:flex print:hidden dark:border-night-ink/15 dark:bg-night-card">
          <BrandLockup homeHref={homeHref} />
          {surface === "warm" ? (
            <CollapsibleSidebarNav sections={navSections} pathname={pathname} />
          ) : (
            <SidebarNav sections={navSections} pathname={pathname} />
          )}
          {userBlock}
        </aside>
      )}

      {/* Mobile drawer */}
      {hasNav && mobileOpen && (
        <div className="fixed inset-0 z-50 print:hidden lg:hidden" role="dialog" aria-modal="true">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-charcoal-ink/40 dark:bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl dark:bg-night-card dark:shadow-none">
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

      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col print:block",
          // The warm patient ground: cards stay white and float on the ivory,
          // while the sidebar and top chrome keep their own white surface.
          // Print always stays white.
          surface === "warm" && "bg-warm-ivory print:bg-white dark:bg-night-ground"
        )}
      >
        <header className="sticky top-0 z-40 border-b border-charcoal-ink/10 bg-white/90 backdrop-blur print:hidden dark:border-night-ink/15 dark:bg-night-ground/90">
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
                  "font-heading text-base font-semibold text-deep-forest dark:text-brand-green-bright",
                  hasNav && "lg:hidden"
                )}
              >
                TarragonHealth
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              {surface === "warm" && <ThemeToggle theme={theme} onChange={setTheme} />}
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
            "px-4 pb-6 text-center text-xs text-charcoal-ink/40 sm:px-6 print:hidden dark:text-night-ink/50",
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

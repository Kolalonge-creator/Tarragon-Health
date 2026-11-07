"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_ICON, NAV_ICON } from "@/lib/icons";
import { Avatar } from "@/components/avatar";
import { itemIsActive, type NavSection } from "@/lib/navigation";
import { buildBreadcrumbs } from "@/lib/navigation-breadcrumbs";

/**
 * The superadmin console's icon-only sidebar (docs/design/SUPERADMIN-CONSOLE.md, phase 2a-2). Folded, the sidebar is a
 * 64px rail: the top band's links as icons, then one icon per labelled group. A group icon is not a page, so pressing
 * it unfolds the sidebar with that group open, rather than guessing which of its pages you wanted. Every icon has a
 * visible label on hover and keyboard focus and an accessible name, so the rail never relies on the icon alone.
 */

/** Which manually-opened sidebar groups to remember between visits (shared with CollapsibleSidebarNav in app-shell). */
export const OPEN_GROUPS_STORAGE_KEY = "nav-open-groups-v1";
const RAIL_STORAGE_KEY = "nav-rail-collapsed-v1";
const RAIL_EVENT = "tarragon:nav-rail";

/**
 * The namespace for remembered open groups: the route's top segment, so one role's "Operations" group never forces the
 * state of another role's group of the same name in a shared browser. CollapsibleSidebarNav (app-shell) reads with it
 * and openNavGroup writes with it; keep it the one place the rule lives.
 */
export function navGroupScope(pathname: string): string {
  return pathname.split("/")[1] || "root";
}

/** Marks a group as opened by hand, in the same per-area namespace CollapsibleSidebarNav reads on mount. */
export function openNavGroup(pathname: string, label: string): void {
  const key = `${navGroupScope(pathname)}::${label}`;
  try {
    const raw = window.localStorage.getItem(OPEN_GROUPS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const keys = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    if (!keys.includes(key)) keys.push(key);
    window.localStorage.setItem(OPEN_GROUPS_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Storage unavailable: the sidebar still unfolds, the group just opens closed.
  }
}

function subscribeRail(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(RAIL_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(RAIL_EVENT, onChange);
  };
}

// Where the fold lives when storage is blocked, so the button still works for this page's lifetime.
let memoryRail: boolean | null = null;

function readRail(): boolean {
  if (memoryRail !== null) return memoryRail;
  try {
    return window.localStorage.getItem(RAIL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether the desktop sidebar is folded, remembered per browser. The server always draws it unfolded. */
export function useRailCollapsed(): [boolean, (collapsed: boolean) => void] {
  const collapsed = React.useSyncExternalStore(subscribeRail, readRail, () => false);
  const set = React.useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(RAIL_STORAGE_KEY, next ? "1" : "0");
      memoryRail = null;
    } catch {
      // Storage unavailable: keep the fold in memory so the button still works, it just won't survive a reload.
      memoryRail = next;
    }
    window.dispatchEvent(new Event(RAIL_EVENT));
  }, []);
  return [collapsed, set];
}

/** The label beside a rail icon, shown on hover and keyboard focus. Decorative: the control carries its own name. */
function RailTip({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-charcoal-ink px-2 py-1 text-xs font-medium text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {children}
    </span>
  );
}

/** A count beside a link, as the shell computes it (a failed read is never shown as zero). */
export interface RailBadge {
  count: number;
  failed: boolean;
}

/** The rolled-up badge on a rail icon: the summed count, or the amber dot when any underlying read failed. */
function RailBadgeMark({ badges }: { badges: (RailBadge | null)[] }) {
  const present = badges.filter((b): b is RailBadge => b !== null);
  if (present.some((b) => b.failed)) {
    return <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500" />;
  }
  const total = present.reduce((sum, b) => sum + b.count, 0);
  if (!total) return null;
  return (
    <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 rounded-full bg-brand-green px-1 text-[10px] font-semibold leading-4 text-white">
      {total > 99 ? "99+" : total}
    </span>
  );
}

/** Words for the same badge, added to the control's name so the rail never relies on the mark alone. */
function badgeWords(badges: (RailBadge | null)[]): string {
  const present = badges.filter((b): b is RailBadge => b !== null);
  if (present.some((b) => b.failed)) return ", count could not load";
  const total = present.reduce((sum, b) => sum + b.count, 0);
  return total ? `, ${total} waiting` : "";
}

const railItemClass =
  "group relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";

export function NavRail({
  sections,
  pathname,
  homeHref,
  profileHref,
  userName,
  avatarUrl,
  badgeFor = () => null,
  onOpenGroup,
  onExpand,
}: {
  /** The badge for a link, from the shell's counts; summed per group icon. */
  badgeFor?: (item: NavSection["items"][number]) => RailBadge | null;
  sections: NavSection[];
  pathname: string;
  homeHref: string;
  profileHref: string;
  userName: string;
  avatarUrl?: string | null;
  onOpenGroup: (label: string) => void;
  onExpand: () => void;
}) {
  return (
    <>
      <Link href={homeHref} aria-label="TarragonHealth home" className="flex justify-center pb-3 pt-5">
        <Image src="/brand/guard-leaf-mark.png" alt="" width={28} height={28} className="h-7 w-7" priority />
      </Link>
      {/* Expand sits at the top, not the bottom: the rail cannot scroll (the labels must stick out of it), so on a short
          window the bottom of it can fall off-screen, and the way back to the full menu must never be what falls off. */}
      <div className="flex justify-center px-3 pb-2">
        <button
          type="button"
          onClick={onExpand}
          aria-expanded={false}
          aria-controls="desktop-sidebar"
          aria-label="Expand menu"
          className={cn(railItemClass, "text-charcoal-ink/50 hover:bg-charcoal-ink/5 hover:text-charcoal-ink")}
        >
          <PanelLeftOpen aria-hidden="true" className="h-4.5 w-4.5" strokeWidth={2} />
          <RailTip>Expand menu</RailTip>
        </button>
      </div>
      {/* overflow stays visible so the hover labels can sit outside the 64px rail. */}
      <nav aria-label="Main" className="flex flex-1 flex-col items-center gap-1 px-3 py-2">
        {sections.map((section, i) => {
          if (!section.label) {
            return (
              <ul key={`band-${i}`} className="flex flex-col items-center gap-1 border-b border-charcoal-ink/10 pb-2">
                {section.items.map((item) => {
                  const Icon = APP_ICON[item.icon];
                  const active = itemIsActive(pathname, item);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        prefetch={false}
                        aria-label={`${item.label}${badgeWords([badgeFor(item)])}`}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          railItemClass,
                          active ? "bg-brand-green/10 text-brand-green" : "text-charcoal-ink/50 hover:bg-charcoal-ink/5 hover:text-charcoal-ink"
                        )}
                      >
                        <Icon aria-hidden="true" className="h-4.5 w-4.5" strokeWidth={2} />
                        <RailBadgeMark badges={[badgeFor(item)]} />
                        <RailTip>{item.label}</RailTip>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            );
          }
          const label = section.label;
          const Icon = APP_ICON[section.icon ?? "menu"];
          const holdsCurrent = section.items.some((item) => itemIsActive(pathname, item));
          const badges = section.items.map(badgeFor);
          return (
            <button
              key={label}
              type="button"
              onClick={() => onOpenGroup(label)}
              aria-label={`${label}: open this group${badgeWords(badges)}`}
              className={cn(
                railItemClass,
                holdsCurrent ? "bg-brand-green/10 text-brand-green" : "text-charcoal-ink/50 hover:bg-charcoal-ink/5 hover:text-charcoal-ink"
              )}
            >
              <Icon aria-hidden="true" className="h-4.5 w-4.5" strokeWidth={2} />
              <RailBadgeMark badges={badges} />
              <RailTip>{label}</RailTip>
            </button>
          );
        })}
      </nav>
      <div className="flex flex-col items-center gap-2 border-t border-charcoal-ink/10 px-3 py-3">
        <Link href={profileHref} aria-label={`${userName}: profile and settings`} className={railItemClass}>
          <Avatar fullName={userName} photoUrl={avatarUrl} size="sm" />
          <RailTip>{userName}</RailTip>
        </Link>
      </div>
    </>
  );
}

/** Where you are in the admin console, from the same nav tree as the sidebar. Hidden on phones, where the header is full. */
export function ConsoleBreadcrumbs({ sections, pathname }: { sections: NavSection[]; pathname: string }) {
  const crumbs = buildBreadcrumbs(sections, pathname);
  if (crumbs.length < 2) return null;
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm text-charcoal-ink/55">
        {crumbs.map((crumb, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <NAV_ICON.chevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-charcoal-ink/30" strokeWidth={2} />}
              {crumb.href ? (
                <Link href={crumb.href} prefetch={false} className="truncate hover:text-charcoal-ink hover:underline">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={cn("truncate", last && "font-medium text-charcoal-ink")}>
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

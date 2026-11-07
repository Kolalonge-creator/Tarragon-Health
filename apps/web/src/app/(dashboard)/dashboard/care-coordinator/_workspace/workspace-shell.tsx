"use client";

import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  CalendarPlus,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  FileUp,
  FlaskConical,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  MessagesSquare,
  NotebookPen,
  PhoneOutgoing,
  Search,
  Siren,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { activeLink, linkIsActive, workspaceSections, type WorkspaceLink } from "@/lib/care-coordinator/workspace-nav";
import { useCoordinationWorkItems } from "@/lib/queries/coordination";
import { useWorkspace } from "./workspace-context";
import { PatientDrawer } from "./patient-drawer";
import { useHydrated } from "./use-hydrated";

const ICON: Record<WorkspaceLink["icon"], LucideIcon> = {
  dashboard: LayoutDashboard,
  worklist: ListChecks,
  patients: Users,
  booking: CalendarPlus,
  outreach: PhoneOutgoing,
  followUp: FlaskConical,
  programme: ClipboardList,
  labs: FileUp,
  messages: MessagesSquare,
  support: LifeBuoy,
  contactLog: NotebookPen,
  operations: Activity,
  escalation: Siren,
  queue: Inbox,
  community: UsersRound,
};

const RAIL_KEY = "tarragon.coordination.rail-collapsed";
const RAIL_EVENT = "tarragon:coordination-rail";
// Fallback when storage is blocked (private window): the choice then lasts for this page only.
let memoryCollapsed = false;

/** Per-viewer convenience only, read through useSyncExternalStore so the server render (expanded) and the client agree. */
function readCollapsed(): boolean {
  try {
    const v = window.localStorage.getItem(RAIL_KEY);
    return v === null ? memoryCollapsed : v === "1";
  } catch {
    return memoryCollapsed;
  }
}
function writeCollapsed(v: boolean) {
  memoryCollapsed = v;
  try {
    window.localStorage.setItem(RAIL_KEY, v ? "1" : "0");
  } catch {
    // storage unavailable: memoryCollapsed carries it
  }
  window.dispatchEvent(new Event(RAIL_EVENT));
}
function subscribeCollapsed(onChange: () => void): () => void {
  window.addEventListener(RAIL_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(RAIL_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Counts for the rail. A failed read shows "?" with a title, never a hidden badge that looks like zero. */
function useRailCounts(): { get: (key: WorkspaceLink["count"]) => string | null } {
  const { userId } = useWorkspace();
  const q = useCoordinationWorkItems();
  const hydrated = useHydrated();
  return {
    get: (key) => {
      if (!key || !hydrated) return null;
      if (q.isError && !q.data) return "?";
      if (!q.data) return null;
      const n = key === "mine" ? q.data.filter((i) => i.assigned_to === userId).length : q.data.filter((i) => i.category === key).length;
      return n > 0 ? (n > 99 ? "99+" : String(n)) : null;
    },
  };
}

function RailLink({ link, active, collapsed, count }: { link: WorkspaceLink; active: boolean; collapsed: boolean; count: string | null }) {
  const Icon = ICON[link.icon];
  return (
    <Link
      href={link.href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? (count ? `${link.label} (${count})` : link.label) : undefined}
      title={collapsed ? link.label : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60",
        active
          ? "bg-soft-sage text-deep-forest dark:bg-brand-green/20 dark:text-night-ink"
          : "text-charcoal-ink/75 hover:bg-charcoal-ink/[0.04] hover:text-charcoal-ink dark:text-night-ink/70 dark:hover:bg-night-ink/10",
        collapsed && "justify-center px-0",
      )}
    >
      {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand-green" />}
      <Icon aria-hidden className={cn("h-4 w-4 shrink-0", active ? "text-brand-green" : "text-charcoal-ink/55 group-hover:text-charcoal-ink/80")} />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{link.label}</span>}
      {count && (
        <span
          className={cn(
            "rounded-full bg-charcoal-ink/[0.07] px-1.5 text-[11px] font-semibold tabular-nums text-charcoal-ink/80 dark:bg-night-ink/15 dark:text-night-ink",
            collapsed && "absolute right-1 top-0.5 px-1 text-[10px]",
          )}
          title={count === "?" ? "Count could not be loaded" : undefined}
        >
          {count}
        </span>
      )}
    </Link>
  );
}

export function WorkspaceShell({ showCommunity, children }: { showCommunity: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const { covering } = useWorkspace();
  const sections = useMemo(() => workspaceSections({ showCommunity }), [showCommunity]);
  const current = activeLink(pathname, sections);
  const counts = useRailCounts();
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const toggle = () => writeCollapsed(!collapsed);

  return (
    <div className="flex min-w-0 gap-6">
      {/* Left rail from 1280px only: beside the app sidebar it needs the room. Narrower screens get the section bar under the header. */}
      <aside
        aria-label="Care coordination"
        className={cn(
          "sticky top-4 hidden max-h-[calc(100vh-2rem)] shrink-0 flex-col self-start overflow-y-auto rounded-2xl border border-charcoal-ink/10 bg-white p-2 xl:flex dark:border-night-ink/15 dark:bg-night-card",
          collapsed ? "w-14" : "w-60",
        )}
      >
        <div className={cn("flex items-center gap-2 px-2.5 pb-2 pt-1.5", collapsed && "justify-center px-0")}>
          {!collapsed && <p className="flex-1 text-xs font-semibold uppercase tracking-wider text-charcoal-ink/50">Care coordination</p>}
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand the menu" : "Collapse the menu"}
            aria-expanded={!collapsed}
            className="rounded-md p-1 text-charcoal-ink/50 hover:bg-charcoal-ink/[0.05] hover:text-charcoal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60"
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden /> : <ChevronsLeft className="h-4 w-4" aria-hidden />}
          </button>
        </div>
        <nav className="space-y-4">
          {sections.map((s) => (
            <div key={s.title}>
              {collapsed ? (
                <hr className="mx-2 mb-2 border-charcoal-ink/10 dark:border-night-ink/15" />
              ) : (
                <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-charcoal-ink/40">{s.title}</p>
              )}
              <ul className="space-y-0.5">
                {s.links.map((l) => (
                  <li key={l.href}>
                    <RailLink link={l} active={linkIsActive(pathname, l)} collapsed={collapsed} count={counts.get(l.count)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1 space-y-5">
        <header className="space-y-3">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-charcoal-ink/55">
            <Link href="/dashboard/care-coordinator" className="hover:text-charcoal-ink hover:underline">
              Care coordination
            </Link>
            <ChevronRight className="h-3 w-3" aria-hidden />
            <span>{current.section}</span>
            {current.link.href !== "/dashboard/care-coordinator" && (
              <>
                <ChevronRight className="h-3 w-3" aria-hidden />
                <span aria-current="page" className="text-charcoal-ink/80">
                  {current.link.label}
                </span>
              </>
            )}
          </nav>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink dark:text-night-ink">{current.link.label}</h1>
              <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{current.link.subtitle}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/dashboard/care-coordinator/patients"
                className="inline-flex items-center gap-1.5 rounded-lg border border-charcoal-ink/15 bg-white px-3 py-2 text-sm font-medium text-charcoal-ink hover:bg-charcoal-ink/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60 dark:border-night-ink/20 dark:bg-night-card dark:text-night-ink"
              >
                <Search className="h-4 w-4" aria-hidden /> Find a patient
              </Link>
              <Link
                href="/dashboard/care-coordinator/book-for-patient"
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 text-sm font-semibold text-white hover:bg-deep-forest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60 focus-visible:ring-offset-2"
              >
                <CalendarPlus className="h-4 w-4" aria-hidden /> Book for a patient
              </Link>
              <Link
                href="/clinician/escalations"
                className="inline-flex items-center gap-1.5 rounded-lg border border-charcoal-ink/15 bg-white px-3 py-2 text-sm font-medium text-charcoal-ink hover:bg-charcoal-ink/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60 dark:border-night-ink/20 dark:bg-night-card dark:text-night-ink"
              >
                <Siren className="h-4 w-4" aria-hidden /> Escalate a concern
              </Link>
            </div>
          </div>
          {covering && (
            <p className="rounded-lg border border-soft-sage bg-soft-sage/50 px-3 py-2 text-sm text-deep-forest dark:border-brand-green/30 dark:bg-brand-green/10 dark:text-night-ink">
              You are covering care coordination. New coordination work comes to a Care Coordinator automatically once one is active, and
              anything the system gave you that you have not started moves to them. Anything you have started stays with you.
            </p>
          )}
          {/* Section bar for phones and tablets: every link, scrollable, the current one marked. */}
          <nav aria-label="Care coordination sections" className="-mx-1 overflow-x-auto xl:hidden">
            <ul className="flex gap-1.5 px-1 pb-1">
              {sections.flatMap((s) => s.links).map((l) => {
                const active = linkIsActive(pathname, l);
                const c = counts.get(l.count);
                return (
                  <li key={l.href} className="shrink-0">
                    <Link
                      href={l.href}
                      prefetch={false}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm",
                        active
                          ? "border-brand-green bg-soft-sage font-semibold text-deep-forest"
                          : "border-charcoal-ink/15 bg-white text-charcoal-ink/75 dark:border-night-ink/20 dark:bg-night-card dark:text-night-ink/75",
                      )}
                    >
                      {l.label}
                      {c && <span className="text-xs tabular-nums text-charcoal-ink/60">{c}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </header>
        <div className="min-w-0">{children}</div>
      </div>
      <PatientDrawer />
    </div>
  );
}

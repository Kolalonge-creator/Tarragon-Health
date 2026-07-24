"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ICON, APP_ICON } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "./notification-bell";
import type { NavSection } from "@/lib/navigation";

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
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
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-charcoal-ink/40">
              {section.label}
            </p>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href, item.exact);
              const Icon = APP_ICON[item.icon];
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-brand-green/10 text-deep-forest"
                        : "text-charcoal-ink/70 hover:bg-charcoal-ink/5 hover:text-charcoal-ink"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4.5 w-4.5 shrink-0",
                        active
                          ? "text-brand-green"
                          : "text-charcoal-ink/40 group-hover:text-charcoal-ink/60"
                      )}
                      strokeWidth={2}
                    />
                    <span className="truncate">{item.label}</span>
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
  roleLabel,
  navSections,
  signOutAction,
  children,
}: {
  userName: string;
  roleLabel: string;
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
  const initials = userName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  const userBlock = (
    <div className="border-t border-charcoal-ink/10 px-4 py-4">
      <div className="flex items-center gap-3">
        <div
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-soft-sage font-heading text-sm font-semibold text-deep-forest"
        >
          {initials || "•"}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-charcoal-ink">{userName}</p>
          <p className="truncate text-xs text-charcoal-ink/50">{roleLabel}</p>
        </div>
        <form action={signOutAction}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-charcoal-ink/50 hover:text-charcoal-ink"
            title="Sign out"
            aria-label="Sign out"
          >
            <NAV_ICON.signOut className="h-4 w-4" strokeWidth={2} />
          </Button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-warm-ivory">
      {/* Desktop sidebar */}
      {hasNav && (
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-charcoal-ink/10 bg-white lg:flex">
          <BrandLockup homeHref={homeHref} />
          <SidebarNav sections={navSections} pathname={pathname} />
          {userBlock}
        </aside>
      )}

      {/* Mobile drawer */}
      {hasNav && mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
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

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-charcoal-ink/10 bg-white/90 backdrop-blur">
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
              <NotificationBell />
              <span className="hidden max-w-48 truncate text-charcoal-ink/70 sm:inline">
                {userName}
              </span>
              <span className="rounded-full bg-brand-green/10 px-2.5 py-1 text-xs font-medium text-deep-forest">
                {roleLabel}
              </span>
              <form action={signOutAction} className={cn(hasNav && "lg:hidden")}>
                <Button type="submit" variant="ghost" size="sm">
                  Sign out
                </Button>
              </form>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {children}
        </main>
        <footer className="px-4 pb-6 text-center text-xs text-charcoal-ink/40 sm:px-6">
          TarragonHealth — Care that stays with you.
        </footer>
      </div>
    </div>
  );
}

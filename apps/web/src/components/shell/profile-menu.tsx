"use client";

import * as React from "react";
import Link from "next/link";
import { NAV_ICON } from "@/lib/icons";
import { Avatar } from "@/components/avatar";

/** Top-right account menu — avatar/name opens a small panel with the caller's
 * role, their patient/staff ID (when they have one), a link to Profile &
 * settings, and sign out. Same click-outside pattern as NotificationBell. */
export function ProfileMenu({
  userName,
  avatarUrl,
  roleLabel,
  idLabel,
  idValue,
  profileHref,
  signOutAction,
}: {
  userName: string;
  avatarUrl?: string | null;
  roleLabel: string;
  idLabel?: string;
  idValue?: string | null;
  profileHref: string;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account menu"
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1 text-sm hover:bg-charcoal-ink/5 sm:pr-2.5"
      >
        <Avatar fullName={userName} photoUrl={avatarUrl} size="sm" />
        <span className="hidden max-w-32 truncate text-charcoal-ink/70 sm:inline">{userName}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-64 max-w-[90vw] rounded-xl border border-charcoal-ink/10 bg-white shadow-lg"
        >
          <div className="border-b border-charcoal-ink/10 px-4 py-3">
            <p className="truncate text-sm font-medium text-charcoal-ink">{userName}</p>
            <span className="mt-1 inline-block rounded-full bg-brand-green/10 px-2 py-0.5 text-xs font-medium text-deep-forest">
              {roleLabel}
            </span>
            {idLabel && idValue && (
              <p className="mt-2 text-xs text-charcoal-ink/50">
                {idLabel}:{" "}
                <span className="font-mono font-medium text-charcoal-ink/70">{idValue}</span>
              </p>
            )}
          </div>
          <div className="p-1">
            <Link
              href={profileHref}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-charcoal-ink/80 hover:bg-charcoal-ink/5"
            >
              <NAV_ICON.settings className="h-4 w-4" strokeWidth={2} />
              Profile &amp; settings
            </Link>
          </div>
          <div className="border-t border-charcoal-ink/10 p-1">
            <form action={signOutAction}>
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-charcoal-ink/70 hover:bg-charcoal-ink/5"
              >
                <NAV_ICON.signOut className="h-4 w-4" strokeWidth={2} />
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

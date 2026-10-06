"use client";

import { Search } from "lucide-react";
import { OPEN_ADMIN_SEARCH_EVENT } from "./admin-search-event";

/**
 * A wide, obvious search bar for the top of the admin dashboard. It is a button that looks like a field: pressing it
 * opens the same search box as the header (so there is one search, one index and one set of shortcuts), where the
 * person types what they are looking for, such as "credential" or "AI coach".
 */
export function OpenAdminSearchBar() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_ADMIN_SEARCH_EVENT))}
      className="flex w-full items-center gap-3 rounded-xl border border-charcoal-ink/15 bg-white px-4 py-3 text-left text-sm text-charcoal-ink/60 shadow-sm hover:border-brand-green/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green dark:border-night-ink/20 dark:bg-night-card dark:text-night-ink/60"
      aria-label="Search the admin console"
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">Search pages, settings and people, for example “credentialing” or “AI coach”</span>
      <kbd className="hidden rounded border border-charcoal-ink/15 px-1.5 text-[11px] font-medium sm:inline dark:border-night-ink/20">Ctrl K</kbd>
    </button>
  );
}

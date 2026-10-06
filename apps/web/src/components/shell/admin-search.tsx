"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { searchAdminEntries, type AdminSearchEntry } from "@/lib/admin-search";

type PersonResult = { label: string; href: string; group: string; hint: string };

/**
 * The admin console's search box. Opens from the header button, Ctrl or Cmd with K, or "/" when no field has focus.
 * Pages and settings are matched instantly in the browser from the list the layout passes in; clinicians and
 * applicants are looked up through /api/admin/search once two letters are typed. Everything is a plain link target,
 * so the keyboard (arrows, Enter, Escape) and a mouse do the same thing.
 */
export function AdminSearch({ entries }: { entries: AdminSearchEntry[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [lookup, setLookup] = React.useState<{ q: string; results: PersonResult[]; failed: boolean } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const opener = React.useRef<HTMLElement | null>(null);

  const close = React.useCallback(() => {
    setOpen(false);
    setQuery("");
    setLookup(null);
    opener.current?.focus();
  }, []);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = e.target instanceof HTMLElement && (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) || e.target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setOpen((o) => !o);
      } else if (e.key === "/" && !typing && !open) {
        e.preventDefault();
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // People lookup, debounced. Each answer is stored with the text it was for, and only shown while that is still what
  // is typed, so a slow or stale answer can never appear under a newer query.
  const trimmed = query.trim();
  React.useEffect(() => {
    if (!open || trimmed.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { results?: PersonResult[]; failed?: boolean };
        setLookup({ q: trimmed, results: body.results ?? [], failed: Boolean(body.failed) });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setLookup({ q: trimmed, results: [], failed: true });
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, open]);

  const current = open && trimmed.length >= 2 && lookup?.q === trimmed ? lookup : null;
  const people = current?.results ?? [];
  const peopleFailed = current?.failed ?? false;

  const pages = React.useMemo(() => searchAdminEntries(entries, query, 8), [entries, query]);
  const rows: (AdminSearchEntry | PersonResult)[] = [...pages, ...people];

  // A newer, shorter list must never leave the highlight pointing past its end.
  const activeIndex = Math.min(active, Math.max(rows.length - 1, 0));

  function go(href: string) {
    close();
    router.push(href);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, Math.max(rows.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[activeIndex];
      if (row) go(row.href);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          opener.current = e.currentTarget;
          setOpen(true);
        }}
        aria-label="Search the admin console"
        className="inline-flex h-9 items-center gap-2 rounded-md border border-charcoal-ink/15 px-2.5 text-sm text-charcoal-ink/70 hover:bg-charcoal-ink/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green dark:border-night-ink/20 dark:text-night-ink/70 dark:hover:bg-night-ink/10"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border border-charcoal-ink/15 px-1 text-[10px] font-medium text-charcoal-ink/55 md:inline dark:border-night-ink/20">Ctrl K</kbd>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div role="dialog" aria-modal="true" aria-label="Search the admin console" className="w-full max-w-xl overflow-hidden rounded-lg border border-charcoal-ink/10 bg-white shadow-xl dark:border-night-ink/20 dark:bg-night-card">
            <div className="flex items-center gap-2 border-b border-charcoal-ink/10 px-3 dark:border-night-ink/15">
              <Search className="h-4 w-4 shrink-0 text-charcoal-ink/50" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKey}
                role="combobox"
                aria-expanded="true"
                aria-controls="admin-search-results"
                aria-activedescendant={rows[activeIndex] ? `admin-search-row-${activeIndex}` : undefined}
                placeholder="Search pages, settings, clinicians, applicants"
                className="h-12 w-full bg-transparent text-sm text-charcoal-ink outline-none placeholder:text-charcoal-ink/45 dark:text-night-ink"
                autoComplete="off"
              />
            </div>
            <ul id="admin-search-results" role="listbox" className="max-h-[60vh] overflow-y-auto py-1">
              {rows.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-charcoal-ink/60 dark:text-night-ink/60">
                  {query.trim() ? "Nothing matches that. Try another word, like a page name or a doctor's name." : "Start typing to search."}
                </li>
              ) : null}
              {rows.map((row, i) => {
                // Pages come first (the group is shown beside each); people follow under a heading per kind.
                const isPerson = i >= pages.length;
                const prev = rows[i - 1];
                const showGroup = isPerson && (i === pages.length || prev?.group !== row.group);
                return (
                  <React.Fragment key={`${row.href}-${i}`}>
                    {showGroup ? (
                      <li role="presentation" className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-charcoal-ink/45">
                        {row.group}
                      </li>
                    ) : null}
                    <li
                      id={`admin-search-row-${i}`}
                      role="option"
                      aria-selected={i === activeIndex}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        go(row.href);
                      }}
                      className={`cursor-pointer px-4 py-2 text-sm ${i === activeIndex ? "bg-brand-green/10" : ""}`}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium text-charcoal-ink dark:text-night-ink">{row.label}</span>
                        {!isPerson ? <span className="shrink-0 text-xs text-charcoal-ink/50">{row.group}</span> : null}
                      </div>
                      {row.hint ? <div className="truncate text-xs text-charcoal-ink/60 dark:text-night-ink/60">{row.hint}</div> : null}
                    </li>
                  </React.Fragment>
                );
              })}
              {peopleFailed ? (
                <li className="px-4 py-2 text-xs text-amber-700 dark:text-amber-300">The people lookup is not available right now, so only pages are shown.</li>
              ) : null}
            </ul>
            <div className="flex justify-between border-t border-charcoal-ink/10 px-4 py-2 text-[11px] text-charcoal-ink/50 dark:border-night-ink/15">
              <span>Arrows to move, Enter to open</span>
              <span>Esc to close</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

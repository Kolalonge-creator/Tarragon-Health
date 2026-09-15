"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shared search + client-side pagination shell for an admin list/table.
 *
 * Most admin managers (members, clinical staff, labs, pharmacies,
 * specialists, resources, notification templates, ...) were each a bespoke
 * `items.map(...)` with no search box and no pagination, which degrades as
 * row counts grow and makes every list feel like a different product. This
 * doesn't force a single visual shape — `renderItem` returns whatever the
 * caller already renders per row (a `<Card>`, a `<details>`, a `<tr>`), and
 * `renderContainer` wraps the rendered items in whatever container that
 * shape needs (a `<div>` stack by default, or a `<table><tbody>` for
 * table-based managers) — so retrofitting an existing manager is a wrap,
 * not a rewrite.
 */
export function SearchableList<T>({
  items,
  filterFn,
  searchPlaceholder = "Search…",
  searchAriaLabel,
  pageSize = 25,
  renderItem,
  renderContainer = (children) => <div className="space-y-2">{children}</div>,
  emptyMessage = "Nothing here yet.",
  noMatchMessage,
  className,
}: {
  items: T[];
  /** Return true if `item` matches the lowercased, trimmed `query`. */
  filterFn: (item: T, query: string) => boolean;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  pageSize?: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  renderContainer?: (children: React.ReactNode) => React.ReactNode;
  /** Shown when `items` itself is empty (nothing to search). */
  emptyMessage?: string;
  /** Shown when a search query matches nothing. Defaults to a generic message quoting the query. */
  noMatchMessage?: (query: string) => string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => filterFn(item, q));
  }, [items, query, filterFn]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);

  function onQueryChange(next: string) {
    setQuery(next);
    setPage(1);
  }

  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-charcoal-ink/60">{emptyMessage}</p>;
  }

  return (
    <div className={cn("space-y-3", className)}>
      <Input
        type="search"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={searchPlaceholder}
        aria-label={searchAriaLabel ?? searchPlaceholder}
      />
      {filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-charcoal-ink/60">
          {noMatchMessage ? noMatchMessage(query) : `No results match "${query}".`}
        </p>
      ) : (
        <>
          {renderContainer(pageItems.map((item, i) => renderItem(item, (clampedPage - 1) * pageSize + i)))}
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-sm">
              <p className="text-charcoal-ink/60">
                Showing {(clampedPage - 1) * pageSize + 1}–
                {Math.min(clampedPage * pageSize, filtered.length)} of {filtered.length}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={clampedPage <= 1}
                  onClick={() => setPage(clampedPage - 1)}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={clampedPage >= totalPages}
                  onClick={() => setPage(clampedPage + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

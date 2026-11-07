"use client";

import * as React from "react";
import { Button } from "./button";
import { Input } from "./input";
import { cn } from "../utils";
import { applyClientTable, nextSort, type ClientRow, type TableSort } from "./data-table-model";

export type { TableSort, SortValue } from "./data-table-model";

/**
 * The staff console's table (docs/design/SUPERADMIN-CONSOLE.md, phase 2a-3). Admin pages each hand-built a <table>
 * with their own search, sorting, paging, empty and error treatment (29 of them); this is the one shape, lifted from
 * the patient directory table, which already did it well.
 *
 * Rows carry pre-rendered cells, not render functions, so a Server Component can hand its rows straight across (a
 * function cannot cross that boundary). Two ways to drive it:
 * - Client mode (default): every row is already here; the table searches `searchText`, sorts by `sort` values and
 *   pages itself.
 * - Server mode: pass `server`; the caller fetches each page and owns search, sort and page state (the patient
 *   directory, where the rows live in the database).
 */
export interface DataTableColumn {
  header: string;
  /** Lets the column be sorted by pressing its header. */
  sortable?: boolean;
  /** Direction a first press sorts in (dates and money usually start newest or largest first). */
  defaultDir?: "asc" | "desc";
  align?: "left" | "right";
  /** Extra classes for this column's cells, e.g. a minimum width. */
  className?: string;
}

export interface DataTableRow extends ClientRow {
  cells: readonly React.ReactNode[];
}

interface ServerControl {
  sort: TableSort | null;
  onSort: (next: TableSort) => void;
  page: number;
  pageCount: number;
  /** Rows matching the current search and filters, across every page. */
  matching: number;
  onPage: (page: number) => void;
  busy?: boolean;
}

export function DataTable({
  caption,
  columns,
  rows,
  searchLabel,
  searchPlaceholder,
  initialSort = null,
  pageSize = 25,
  emptyMessage = "Nothing here yet.",
  noun = { one: "row", many: "rows" },
  error,
  toolbar,
  server,
  className,
}: {
  /** What the table lists, read out to screen readers (and the first thing a reader of the code should see). */
  caption: string;
  columns: readonly DataTableColumn[];
  rows: readonly DataTableRow[];
  /** Shows a search box (client mode only; a server-mode caller draws its own, since the search is a query). */
  searchLabel?: string;
  searchPlaceholder?: string;
  initialSort?: TableSort | null;
  pageSize?: number;
  emptyMessage?: string;
  /** For the count line: "12 patients", "1 patient". */
  noun?: { one: string; many: string };
  /** A failed load. Shown above the table; the rows shown stay whatever the caller passes (often the previous view). */
  error?: string | null;
  /** Filters or actions drawn beside the search box. */
  toolbar?: React.ReactNode;
  server?: ServerControl;
  className?: string;
}) {
  const searchId = React.useId();
  const [query, setQuery] = React.useState("");
  const [clientSort, setClientSort] = React.useState<TableSort | null>(initialSort);
  const [clientPage, setClientPage] = React.useState(0);

  const view = server
    ? { rows: [...rows], ordered: [...rows], matching: server.matching, page: server.page, pageCount: Math.max(1, server.pageCount) }
    : applyClientTable(rows, { query, sort: clientSort, page: clientPage, pageSize });
  const shownKeys = new Set(view.rows.map((r) => r.key));
  const sort = server ? server.sort : clientSort;
  const busy = server?.busy ?? false;

  function pressHeader(column: number) {
    setInteracted(true);
    const next = nextSort(sort, column, columns[column]?.defaultDir ?? "asc");
    if (server) server.onSort(next);
    else {
      setClientSort(next);
      setClientPage(0);
    }
  }

  function goTo(page: number) {
    setInteracted(true);
    if (server) server.onPage(page);
    else setClientPage(page);
  }

  // The count line is read out only after the reader changes the view (search, sort, page), and only once typing
  // pauses: never on page load, where a page with three tables would otherwise read out three counts unprompted.
  const countText = `${view.matching} ${view.matching === 1 ? noun.one : noun.many}${!server && query.trim() !== "" ? " match your search" : ""}${view.pageCount > 1 ? `. Page ${view.page + 1} of ${view.pageCount}.` : "."}`;
  const [announced, setAnnounced] = React.useState("");
  const [interacted, setInteracted] = React.useState(false);
  React.useEffect(() => {
    if (!interacted) return;
    const timer = setTimeout(() => setAnnounced(countText), 700);
    return () => clearTimeout(timer);
  }, [countText, interacted]);

  const showSearch = !server && !!searchLabel;
  const searching = !server && query.trim() !== "";

  return (
    <div className={cn("space-y-3", className)}>
      {(showSearch || toolbar) && (
        <div className="flex flex-wrap items-end gap-3">
          {showSearch && (
            <div className="w-full sm:w-72">
              <label htmlFor={searchId} className="block text-sm font-medium text-charcoal-ink dark:text-night-ink">
                {searchLabel}
              </label>
              <Input
                id={searchId}
                type="search"
                className="mt-1"
                value={query}
                placeholder={searchPlaceholder}
                autoComplete="off"
                onChange={(e) => {
                  setInteracted(true);
                  setQuery(e.target.value);
                  setClientPage(0);
                }}
              />
            </div>
          )}
          {toolbar && <div className="flex flex-wrap items-end gap-2 sm:ml-auto">{toolbar}</div>}
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
          {error}
        </p>
      )}

      <div
        className={cn(
          // A long table keeps its header row in view: the wrapper scrolls (both ways) and the header sticks inside it.
          "max-h-[70vh] overflow-auto rounded-xl border border-charcoal-ink/10 bg-white dark:border-night-ink/15 dark:bg-night-card",
          busy && "opacity-60"
        )}
        aria-busy={busy || undefined}
      >
        <table className="min-w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 bg-white text-xs uppercase tracking-wide text-charcoal-ink/70 dark:bg-night-card dark:text-night-ink/70">
            <tr>
              {columns.map((col, i) => {
                const active = sort?.column === i;
                return (
                  <th
                    key={`${col.header}-${i}`}
                    scope="col"
                    aria-sort={col.sortable && active ? (sort?.dir === "asc" ? "ascending" : "descending") : undefined}
                    // The border sits on each cell, not the row, so it travels with the sticky header.
                    className={cn(
                      "whitespace-nowrap border-b border-charcoal-ink/10 bg-charcoal-ink/[0.03] px-3 py-2 font-semibold dark:border-night-ink/15",
                      col.align === "right" && "text-right"
                    )}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => pressHeader(i)}
                        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-charcoal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
                      >
                        {col.header}
                        <span aria-hidden="true" className={cn(!active && "opacity-30")}>
                          {active ? (sort?.dir === "asc" ? "↑" : "↓") : "↕"}
                        </span>
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
            {view.rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-charcoal-ink/60 dark:text-night-ink/60">
                  {searching ? `Nothing matches "${query.trim()}".` : emptyMessage}
                </td>
              </tr>
            )}
            {view.ordered.map((row) => (
              <tr key={row.key} hidden={!shownKeys.has(row.key)} className="align-top hover:bg-charcoal-ink/[0.02]">
                {columns.map((col, i) => (
                  <td
                    key={`${row.key}-${i}`}
                    className={cn("px-3 py-2", col.align === "right" && "text-right tabular-nums", col.className)}
                  >
                    {row.cells[i] ?? null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
        <p>{countText}</p>
        <span className="sr-only" aria-live="polite">{announced}</span>
        {view.pageCount > 1 && (
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy || view.page === 0} onClick={() => goTo(view.page - 1)}>
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || view.page + 1 >= view.pageCount}
              onClick={() => goTo(view.page + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The pure half of DataTable: search, sort and paging over rows already in hand. Kept apart from the component so the
 * rules (how a missing value sorts, how a page clamps after a search shrinks the list) are tested without rendering.
 */

/** A sortable cell's value. `null` (no value) always sorts last, whichever way the column is sorted. */
export type SortValue = string | number | null;

export interface TableSort {
  /** Column index. */
  column: number;
  dir: "asc" | "desc";
}

export interface ClientRow {
  key: string;
  /** One value per column; a column whose header is not sortable may leave its slot null. */
  sort?: readonly SortValue[];
  /** The words a search matches against (lowercased here). Rows without it never match a non-empty search. */
  searchText?: string;
}

export interface ClientTableResult<R> {
  /** The rows to show: matching the search, sorted, this page only. */
  rows: R[];
  /**
   * Every row, sorted, whether shown or not. The table renders all of these and hides the ones not in `rows`, so a row
   * that holds state (a half-typed note, a key shown once) is never unmounted by a search or a page change.
   */
  ordered: R[];
  /** Rows matching the search, across all pages. */
  matching: number;
  /** 0-based page actually shown, after clamping. */
  page: number;
  pageCount: number;
}

function compare(a: SortValue, b: SortValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en-GB", { numeric: true, sensitivity: "base" });
}

export function applyClientTable<R extends ClientRow>(
  rows: readonly R[],
  { query, sort, page, pageSize }: { query: string; sort: TableSort | null; page: number; pageSize: number },
): ClientTableResult<R> {
  const q = query.trim().toLowerCase();
  const ordered = [...rows];

  if (sort) {
    const sign = sort.dir === "asc" ? 1 : -1;
    // Array.prototype.sort is stable, so equal values keep the order the page supplied.
    ordered.sort((x, y) => {
      const a = x.sort?.[sort.column] ?? null;
      const b = y.sort?.[sort.column] ?? null;
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return sign * compare(a, b);
    });
  }

  const filtered = q ? ordered.filter((r) => (r.searchText ?? "").toLowerCase().includes(q)) : ordered;
  const size = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(filtered.length / size));
  const shown = Math.min(Math.max(0, page), pageCount - 1);
  return { rows: filtered.slice(shown * size, shown * size + size), ordered, matching: filtered.length, page: shown, pageCount };
}

/** The next sort after pressing a column header: a new column starts on its default direction, the same column flips. */
export function nextSort(current: TableSort | null, column: number, defaultDir: "asc" | "desc" = "asc"): TableSort {
  if (current && current.column === column) return { column, dir: current.dir === "asc" ? "desc" : "asc" };
  return { column, dir: defaultDir };
}

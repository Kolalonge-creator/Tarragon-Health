"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoadFailure, StaleDataNotice } from "@/components/ui/load-failure";
import { cn } from "@/lib/utils";
import { refreshQueryState } from "@/lib/queries/list-query-state";
import { WORK_ITEM_LIMIT, useCoordinationWorkItems } from "@/lib/queries/coordination";
import {
  CATEGORY_LABEL,
  SAVED_VIEWS,
  STATUS_LABEL,
  WORK_STATUSES,
  applyFilters,
  applySavedView,
  isSavedViewId,
  paginate,
  sortItems,
  type SavedViewId,
  type SortKey,
  type WorkCategory,
  type WorkStatus,
} from "@/lib/care-coordinator/work-items";
import { useWorkspace } from "../_workspace/workspace-context";
import { WorkTable } from "../_workspace/work-table";
import { useHydrated } from "../_workspace/use-hydrated";

const SORTS: { id: SortKey; label: string }[] = [
  { id: "priority", label: "Most urgent first" },
  { id: "due", label: "Soonest due" },
  { id: "waiting", label: "Waiting longest" },
  { id: "patient", label: "Patient name" },
];

const fieldClass =
  "rounded-lg border border-charcoal-ink/15 bg-white px-3 py-2 text-sm text-charcoal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60 dark:border-night-ink/20 dark:bg-night-card dark:text-night-ink";

export function UnifiedWorklist() {
  const { userId } = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get("view");
  const view: SavedViewId = isSavedViewId(raw) ? raw : "mine";

  const q = useCoordinationWorkItems();
  const hydrated = useHydrated();
  const qData = hydrated ? q.data : undefined;
  const state = hydrated ? refreshQueryState({ isLoading: q.isLoading, isError: q.isError, hasData: q.data !== undefined }) : "loading";
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<WorkCategory | "all">("all");
  const [status, setStatus] = useState<WorkStatus | "all">("all");
  const [sort, setSort] = useState<SortKey>("priority");
  const [page, setPage] = useState(1);

  const now = useMemo(() => new Date(), [q.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => qData ?? [], [qData]);
  const viewCounts = useMemo(
    () => Object.fromEntries(SAVED_VIEWS.map((v) => [v.id, applySavedView(all, v.id, userId, now).length])) as Record<SavedViewId, number>,
    [all, userId, now],
  );
  const rows = sortItems(applyFilters(applySavedView(all, view, userId, now), { search, category, status }), sort, now);
  const paged = paginate(rows, page);

  const setView = (v: SavedViewId) => {
    setPage(1);
    const next = new URLSearchParams(params.toString());
    next.set("view", v);
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-4">
      {state === "failed" && <LoadFailure>The worklist could not be loaded. Nothing below is a real &ldquo;empty&rdquo;: reload the page.</LoadFailure>}
      {state === "stale" && <StaleDataNotice>Could not refresh just now; showing the last good read.</StaleDataNotice>}
      {all.length >= WORK_ITEM_LIMIT && (
        <StaleDataNotice>Only the oldest {WORK_ITEM_LIMIT} open items are loaded. Newer ones exist; tell the care lead about the backlog.</StaleDataNotice>
      )}

      <div role="tablist" aria-label="Saved views" className="flex flex-wrap gap-1.5">
        {SAVED_VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={v.id === view}
            onClick={() => setView(v.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60",
              v.id === view
                ? "border-brand-green bg-soft-sage font-semibold text-deep-forest"
                : "border-charcoal-ink/15 bg-white text-charcoal-ink/75 hover:border-charcoal-ink/30 dark:border-night-ink/20 dark:bg-night-card dark:text-night-ink/75",
            )}
          >
            {v.label}
            <span className="tabular-nums text-xs text-charcoal-ink/55">{state === "failed" ? "?" : qData ? viewCounts[v.id] : "…"}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs font-medium text-charcoal-ink/60">
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Patient name, number or owner"
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-charcoal-ink/60">
          Category
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as WorkCategory | "all");
              setPage(1);
            }}
            className={fieldClass}
          >
            <option value="all">All categories</option>
            {(Object.keys(CATEGORY_LABEL) as WorkCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-charcoal-ink/60">
          Status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as WorkStatus | "all");
              setPage(1);
            }}
            className={fieldClass}
          >
            <option value="all">Any status</option>
            {WORK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-charcoal-ink/60">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={fieldClass}>
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-sm text-charcoal-ink/60" aria-live="polite">
        {state === "loading" ? "Loading…" : state === "failed" ? "" : `${rows.length} item${rows.length === 1 ? "" : "s"}`}
      </p>

      {state !== "failed" && (
        <WorkTable
          items={paged.rows}
          emptyText={state === "loading" ? "Loading…" : search || category !== "all" || status !== "all" ? "Nothing matches these filters." : "Nothing in this view."}
        />
      )}

      {paged.pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={paged.page <= 1}
            onClick={() => setPage(paged.page - 1)}
            className="rounded-lg border border-charcoal-ink/15 px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="tabular-nums text-charcoal-ink/60">
            Page {paged.page} of {paged.pages}
          </span>
          <button
            type="button"
            disabled={paged.page >= paged.pages}
            onClick={() => setPage(paged.page + 1)}
            className="rounded-lg border border-charcoal-ink/15 px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}

      <p className="text-xs text-charcoal-ink/50">
        Taking an item puts it on your list and keeps it there. Work the system gave a doctor that nobody has started moves to a Care
        Coordinator once one is active. Closing a task here never closes a clinical review or an escalation: those stay with a doctor.
      </p>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAssignWorkItems, useSupportDeskStaff, useSupportWorkItems } from "@/lib/queries/support-desk";
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  QUEUE_TABS,
  SLA_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  canBulkAssign,
  describeDue,
  filterQueue,
  sortByUrgency,
  type Priority,
  type QueueFilters,
  type QueueTab,
  type SlaState,
  type StatusGroup,
  type WorkSource,
} from "@/lib/support-desk/model";

const PAGE_SIZE = 50;
const SAVED_KEY = "support-desk.saved-views.v1";

type SavedView = { name: string; tab: QueueTab; filters: QueueFilters };

// Saved views are a per-browser convenience (design doc: never shared state). Read through useSyncExternalStore so the
// server render and the first client render agree, and a private window with no storage simply has none.
const savedListeners = new Set<() => void>();
function readSavedRaw(): string {
  try {
    return window.localStorage.getItem(SAVED_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}
function parseSaved(raw: string): SavedView[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedView[]) : [];
  } catch {
    return [];
  }
}
function subscribeSaved(cb: () => void) {
  savedListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    savedListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function writeSaved(views: SavedView[]) {
  try {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(views));
  } catch {
    // Browser storage unavailable (private window): saved views just do not persist.
  }
  savedListeners.forEach((cb) => cb());
}

const slaVariant = (s: string | null) => (s === "breached" ? "red" : s === "at_risk" ? "amber" : s === "clinical" ? "blue" : "grey");
const selectClass = "rounded-md border border-charcoal-ink/15 bg-white px-2 py-1.5 text-sm dark:border-night-ink/20 dark:bg-transparent";

export function QueueWorkspace({ me, isLead, initialTab, initialSla }: { me: string; isLead: boolean; initialTab: QueueTab; initialSla?: string }) {
  const items = useSupportWorkItems();
  const staff = useSupportDeskStaff();
  const assign = useAssignWorkItems();
  const [tab, setTabState] = useState<QueueTab>(initialTab);
  const [filters, setFiltersState] = useState<QueueFilters>({ source: "all", priority: "all", sla: (initialSla as SlaState) ?? "all", search: "" });
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignee, setAssignee] = useState<string>("");
  const savedRaw = useSyncExternalStore(subscribeSaved, readSavedRaw, () => "[]");
  const saved = useMemo(() => parseSaved(savedRaw), [savedRaw]);
  const [message, setMessage] = useState<string | null>(null);
  const now = new Date();

  // Changing the tab or a filter starts again at page one with nothing selected.
  const setTab = (t: QueueTab) => {
    setTabState(t);
    setPage(0);
    setSelected(new Set());
  };
  const setFilters = (f: QueueFilters) => {
    setFiltersState(f);
    setPage(0);
    setSelected(new Set());
  };

  const rows = useMemo(() => sortByUrgency(filterQueue(items.data ?? [], tab, me, filters)), [items.data, tab, me, filters]);
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const keyOf = (i: { source: string | null; item_id: string | null }) => `${i.source}:${i.item_id}`;
  const selectable = pageRows.filter(canBulkAssign);

  async function runAssign(target: string | null, list: { source: string; itemId: string }[]) {
    setMessage(null);
    try {
      await assign.mutateAsync({ items: list, assignee: target });
      setSelected(new Set());
      setMessage(`${list.length} item${list.length === 1 ? "" : "s"} assigned.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not assign.");
    }
  }

  function saveView() {
    const name = window.prompt("Name this view");
    if (!name?.trim()) return;
    writeSaved([...saved.filter((v) => v.name !== name.trim()), { name: name.trim(), tab, filters }]);
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Queues" className="flex flex-wrap gap-1.5">
        {QUEUE_TABS.map((t) => {
          const count = filterQueue(items.data ?? [], t.key, me, { includeTest: filters.includeTest }).length;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={
                tab === t.key
                  ? "rounded-full bg-brand-green px-3 py-1 text-sm font-medium text-white"
                  : "rounded-full border border-charcoal-ink/15 px-3 py-1 text-sm text-charcoal-ink/75 hover:border-brand-green/50 dark:border-night-ink/20 dark:text-night-ink/75"
              }
            >
              {t.label} <span className="tabular-nums opacity-75">{count}</span>
            </button>
          );
        })}
      </div>

      <Card>
        <CardContent className="space-y-3 pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Search
              <input
                type="search"
                placeholder="Reference, subject or name"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                className={`${selectClass} w-56`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Type
              <select className={selectClass} value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value as WorkSource | "all" })}>
                <option value="all">All types</option>
                {Object.entries(SOURCE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Priority
              <select className={selectClass} value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value as Priority | "all" })}>
                <option value="all">Any priority</option>
                {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Target
              <select className={selectClass} value={filters.sla} onChange={(e) => setFilters({ ...filters, sla: e.target.value as SlaState | "all" })}>
                <option value="all">Any</option>
                {Object.entries(SLA_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 pb-1.5 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
              <input type="checkbox" checked={!!filters.includeTest} onChange={(e) => setFilters({ ...filters, includeTest: e.target.checked })} />
              Show test accounts
            </label>
            <div className="ml-auto flex items-end gap-2">
              {saved.length > 0 && (
                <select
                  aria-label="Saved views"
                  className={selectClass}
                  value=""
                  onChange={(e) => {
                    const v = saved.find((s) => s.name === e.target.value);
                    if (v) {
                      setTab(v.tab);
                      setFilters(v.filters);
                    }
                  }}
                >
                  <option value="">Saved views</option>
                  {saved.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              )}
              <Button type="button" variant="outline" size="sm" onClick={saveView}>
                Save this view
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-md bg-charcoal-ink/[0.03] px-3 py-2 text-sm dark:bg-night-ink/5">
            <span className="text-charcoal-ink/70 dark:text-night-ink/70">{selected.size} selected</span>
            {isLead ? (
              <>
                <select aria-label="Assign to" className={selectClass} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                  <option value="">Choose a person</option>
                  {(staff.data ?? []).map((s) => (
                    <option key={s.profile_id} value={s.profile_id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  disabled={selected.size === 0 || !assignee || assign.isPending}
                  onClick={() =>
                    runAssign(
                      assignee,
                      [...selected].map((k) => {
                        const [source = "", itemId = ""] = k.split(":");
                        return { source, itemId };
                      }),
                    )
                  }
                >
                  Assign selected
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={selected.size === 0 || assign.isPending}
                onClick={() =>
                  runAssign(
                    me,
                    [...selected].map((k) => {
                      const [source = "", itemId = ""] = k.split(":");
                      return { source, itemId };
                    }),
                  )
                }
              >
                Take selected
              </Button>
            )}
            <span className="text-xs text-charcoal-ink/50 dark:text-night-ink/50">Complaints are assigned inside the complaint workflow. Nothing here closes or deletes work.</span>
            {message && (
              <span role="status" className="basis-full text-sm text-charcoal-ink/80 dark:text-night-ink/80">
                {message}
              </span>
            )}
          </div>

          {items.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {items.isError && <p role="alert" className="text-sm text-red-700">The queue could not be loaded.</p>}
          {items.data && rows.length === 0 && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Nothing here.</p>}

          {pageRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[60rem] text-left text-sm">
                <thead className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                  <tr>
                    <th className="w-8 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select all on this page"
                        checked={selectable.length > 0 && selectable.every((i) => selected.has(keyOf(i)))}
                        onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map(keyOf)) : new Set())}
                      />
                    </th>
                    <th className="py-2 pr-3 font-medium">Reference</th>
                    <th className="py-2 pr-3 font-medium">Subject</th>
                    <th className="py-2 pr-3 font-medium">Customer</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Category</th>
                    <th className="py-2 pr-3 font-medium">Priority</th>
                    <th className="py-2 pr-3 font-medium">Owner</th>
                    <th className="py-2 pr-3 font-medium">Received</th>
                    <th className="py-2 pr-3 font-medium">Target</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((i) => {
                    const k = keyOf(i);
                    const bulk = canBulkAssign(i);
                    return (
                      <tr key={k} className="border-t border-charcoal-ink/10 align-top dark:border-night-ink/15">
                        <td className="py-2">
                          <input
                            type="checkbox"
                            aria-label={`Select ${i.reference}`}
                            disabled={!bulk}
                            checked={selected.has(k)}
                            onChange={(e) => {
                              const next = new Set(selected);
                              if (e.target.checked) next.add(k);
                              else next.delete(k);
                              setSelected(next);
                            }}
                          />
                        </td>
                        <td className="py-2 pr-3 font-medium tabular-nums">{i.reference}</td>
                        <td className="max-w-[18rem] py-2 pr-3">
                          <span className="line-clamp-2">{i.subject}</span>
                          {(i.open_handoffs ?? 0) > 0 && <span className="text-xs text-charcoal-ink/55 dark:text-night-ink/55">With another team</span>}
                        </td>
                        <td className="py-2 pr-3">{i.customer_name ?? "Customer"}</td>
                        <td className="py-2 pr-3">{SOURCE_LABEL[i.source as WorkSource] ?? i.source}</td>
                        <td className="py-2 pr-3">{CATEGORY_LABEL[i.category ?? ""] ?? i.category}</td>
                        <td className="py-2 pr-3">{PRIORITY_LABEL[i.priority as Priority] ?? i.priority}</td>
                        <td className="py-2 pr-3">{i.assigned_to_name ?? "No owner"}</td>
                        <td className="py-2 pr-3 tabular-nums">
                          {i.received_at ? new Date(i.received_at).toLocaleString("en-NG", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge variant={slaVariant(i.sla_state)}>{SLA_LABEL[i.sla_state as SlaState] ?? i.sla_state}</Badge>
                          {(i.sla_state === "breached" || i.sla_state === "at_risk" || i.sla_state === "on_track") && (
                            <div className="text-xs text-charcoal-ink/55 dark:text-night-ink/55">{describeDue(i.next_due_at, now)}</div>
                          )}
                        </td>
                        <td className="py-2 pr-3">{STATUS_LABEL[i.status_group as StatusGroup] ?? i.status_group}</td>
                        <td className="py-2 whitespace-nowrap">
                          <div className="flex gap-2">
                            {bulk && i.assigned_to !== me && (
                              <button
                                type="button"
                                className="text-sm font-medium text-brand-green underline-offset-2 hover:underline disabled:opacity-50 dark:text-brand-green-bright"
                                disabled={assign.isPending}
                                onClick={() => runAssign(me, [{ source: i.source ?? "", itemId: i.item_id ?? "" }])}
                              >
                                Take
                              </button>
                            )}
                            <Link href={i.detail_href ?? "#"} className="text-sm font-medium text-brand-green underline-offset-2 hover:underline dark:text-brand-green-bright">
                              Open
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {rows.length > PAGE_SIZE && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-charcoal-ink/60 dark:text-night-ink/60">
                {page * PAGE_SIZE + 1} to {Math.min(rows.length, (page + 1) * PAGE_SIZE)} of {rows.length}
              </span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= rows.length} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

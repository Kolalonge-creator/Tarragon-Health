"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTakeOverWorkItem } from "@/lib/queries/coordination";
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  canTakeOver,
  isOverdue,
  workItemHref,
  type WorkItem,
  type WorkSource,
} from "@/lib/care-coordinator/work-items";
import { useWorkspace } from "./workspace-context";
import { workItemTitle } from "./work-item-labels";
import { dueText, timeAgo } from "./format";

const PRIORITY_DOT: Record<1 | 2 | 3, string> = {
  1: "bg-status-urgent",
  2: "bg-status-info",
  3: "bg-status-inactive",
};

function Priority({ p }: { p: 1 | 2 | 3 }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-charcoal-ink/75 dark:text-night-ink/75">
      <span aria-hidden className={cn("h-2 w-2 rounded-full", PRIORITY_DOT[p])} />
      {PRIORITY_LABEL[p]}
    </span>
  );
}

function StatusBadge({ item, now }: { item: WorkItem; now: Date }) {
  if (isOverdue(item, now)) return <Badge variant="amber">Overdue</Badge>;
  const variant = item.status === "open" ? "blue" : item.status === "in_progress" ? "green" : "grey";
  return <Badge variant={variant}>{STATUS_LABEL[item.status]}</Badge>;
}

function Owner({ item, me }: { item: WorkItem; me: string }) {
  if (!item.assigned_to) return <span className="text-charcoal-ink/50">Unassigned</span>;
  const label = item.assigned_to === me ? "You" : (item.assigned_name ?? "Someone");
  return (
    <span className="whitespace-nowrap">
      {label}
      {item.auto_assigned && <span className="ml-1 text-xs text-charcoal-ink/45">(auto)</span>}
    </span>
  );
}

function Actions({ item, me }: { item: WorkItem; me: string }) {
  const { openPatient } = useWorkspace();
  const take = useTakeOverWorkItem();
  const [error, setError] = useState<string | null>(null);
  const showTake = canTakeOver(item) && item.assigned_to !== me;
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Link
        href={workItemHref(item)}
        className="rounded-md px-2 py-1 text-xs font-semibold text-brand-green hover:bg-soft-sage focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60"
      >
        Open
      </Link>
      <button
        type="button"
        onClick={() => openPatient(item.patient_id)}
        className="rounded-md px-2 py-1 text-xs font-medium text-charcoal-ink/70 hover:bg-charcoal-ink/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60"
      >
        Patient
      </button>
      {showTake && (
        <button
          type="button"
          disabled={take.isPending}
          onClick={() => {
            setError(null);
            take.mutate(
              { source: item.source as Exclude<WorkSource, "queue">, itemId: item.item_id, me },
              { onError: (e) => setError(e instanceof Error ? e.message : "Could not take it") },
            );
          }}
          className="rounded-md border border-charcoal-ink/15 px-2 py-1 text-xs font-medium text-charcoal-ink hover:bg-charcoal-ink/[0.04] disabled:opacity-50 dark:border-night-ink/20 dark:text-night-ink"
        >
          {take.isPending ? "Taking…" : "Take it"}
        </button>
      )}
      {error && (
        <p role="alert" className="w-full text-right text-xs text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The unified worklist table: a real table from `md` up and stacked cards on phones (no sideways scrolling of a wide table).
 * Every row shows priority, patient, task, category, due, status, owner, last activity and its next step.
 */
export function WorkTable({ items, emptyText, compact = false }: { items: WorkItem[]; emptyText: string; compact?: boolean }) {
  const { userId, openPatient } = useWorkspace();
  const now = new Date();
  if (items.length === 0) {
    return <p className="rounded-xl border border-dashed border-charcoal-ink/15 px-4 py-8 text-center text-sm text-charcoal-ink/60">{emptyText}</p>;
  }
  return (
    <>
      <div className="relative hidden overflow-x-auto rounded-xl border border-charcoal-ink/10 lg:block dark:border-night-ink/15">
        <table className="w-full text-sm">
          <thead className="bg-charcoal-ink/[0.025] text-left text-xs font-semibold uppercase tracking-wider text-charcoal-ink/55 dark:bg-night-ink/5">
            <tr>
              <th scope="col" className="px-3 py-2.5">Priority</th>
              <th scope="col" className="px-3 py-2.5">Patient</th>
              <th scope="col" className="px-3 py-2.5">Task</th>
              {!compact && <th scope="col" className="px-3 py-2.5">Due</th>}
              <th scope="col" className="px-3 py-2.5">Status</th>
              <th scope="col" className="px-3 py-2.5">Owner</th>
              {!compact && <th scope="col" className="hidden px-3 py-2.5 xl:table-cell">Last activity</th>}
              <th scope="col" className="px-3 py-2.5 text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-charcoal-ink/[0.07] dark:divide-night-ink/10">
            {items.map((i) => (
              <tr key={`${i.source}-${i.item_id}`} className="align-top hover:bg-charcoal-ink/[0.015]">
                <td className="px-3 py-2.5">
                  <Priority p={i.priority as 1 | 2 | 3} />
                </td>
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => openPatient(i.patient_id)}
                    className="text-left font-semibold text-charcoal-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60 dark:text-night-ink"
                  >
                    {i.patient_name ?? "Patient"}
                  </button>
                  {i.patient_number && <p className="text-xs tabular-nums text-charcoal-ink/50">{i.patient_number}</p>}
                </td>
                <td className="px-3 py-2.5">
                  <p className="text-charcoal-ink dark:text-night-ink">{workItemTitle(i)}</p>
                  <p className="text-xs text-charcoal-ink/50">{CATEGORY_LABEL[i.category]}</p>
                </td>
                {!compact && (
                  <td className={cn("whitespace-nowrap px-3 py-2.5 tabular-nums", isOverdue(i, now) ? "font-medium text-status-attention-text" : "text-charcoal-ink/70")}>
                    {dueText(i.due_at, now)}
                  </td>
                )}
                <td className="px-3 py-2.5">
                  <StatusBadge item={i} now={now} />
                </td>
                <td className="px-3 py-2.5 text-charcoal-ink/80">
                  <Owner item={i} me={userId} />
                </td>
                {!compact && (
                  <td className="hidden whitespace-nowrap px-3 py-2.5 text-xs text-charcoal-ink/55 xl:table-cell">{timeAgo(i.last_activity_at ?? i.created_at, now)}</td>
                )}
                <td className="px-3 py-2.5">
                  <Actions item={i} me={userId} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 lg:hidden">
        {items.map((i) => (
          <li key={`${i.source}-${i.item_id}`} className="rounded-xl border border-charcoal-ink/10 bg-white p-3 dark:border-night-ink/15 dark:bg-night-card">
            <div className="flex items-start justify-between gap-2">
              <button type="button" onClick={() => openPatient(i.patient_id)} className="text-left font-semibold text-charcoal-ink hover:underline dark:text-night-ink">
                {i.patient_name ?? "Patient"}
              </button>
              <StatusBadge item={i} now={now} />
            </div>
            <p className="mt-1 text-sm text-charcoal-ink dark:text-night-ink">{workItemTitle(i)}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-charcoal-ink/60">
              <Priority p={i.priority as 1 | 2 | 3} />
              <span>{dueText(i.due_at, now)}</span>
              <Owner item={i} me={userId} />
            </div>
            <div className="mt-2">
              <Actions item={i} me={userId} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

"use client";

import { useState } from "react";
import { StatTile } from "@/components/ui/stat-tile";
import { Activity, ListChecks, ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuditLog, useAuditSummary, type AuditFilters } from "@/lib/analytics/queries";
import { formatNumber } from "@/lib/analytics/format";
import type { AuditRow } from "@/lib/analytics/schemas";
import { CenterNote, MiniBarList, SectionCard } from "./primitives";
import { ExportButton } from "./export-button";

const PAGE_SIZE = 50;

/**
 * Most audit_log rows come from the generic row-change trigger, whose event
 * payload carries a `changed_columns` array of column-name strings — render
 * that as a readable list rather than truncated JSON. Any other event shape
 * (rows from other sources) falls back to the original raw-JSON preview.
 */
function eventPreview(event: unknown): string {
  if (event === null || event === undefined) return "";
  if (typeof event === "object" && !Array.isArray(event)) {
    const changed = (event as Record<string, unknown>).changed_columns;
    if (Array.isArray(changed) && changed.every((c) => typeof c === "string")) {
      const list = changed as string[];
      return `changed: ${list.join(", ")}`;
    }
  }
  const s = JSON.stringify(event);
  return s.length > 80 ? `${s.slice(0, 79)}…` : s;
}

const RESULT_BADGE: Record<string, "green" | "red" | "amber" | "grey"> = {
  success: "green",
  denied: "red",
  failed: "red",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function AuditDashboard() {
  const [draft, setDraft] = useState({ action: "", entityType: "", from: "", to: "" });
  const [applied, setApplied] = useState<AuditFilters>({});
  const [page, setPage] = useState(0);

  const filters: AuditFilters = { ...applied, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
  const log = useAuditLog(filters);
  const summary = useAuditSummary(applied.from, applied.to);

  const rows = log.data?.rows ?? [];
  const total = log.data?.total ?? 0;
  const pageCount = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const exportRows = rows.map((r: AuditRow) => ({
    created_at: r.created_at,
    action: r.action,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    actor_name: r.actor_name,
    organisation: r.organisation_name,
    result: r.result,
    reason: r.reason,
    event: JSON.stringify(r.event ?? {}),
  }));

  function apply() {
    setApplied({
      action: draft.action.trim() || null,
      entityType: draft.entityType.trim() || null,
      from: draft.from || null,
      to: draft.to || null,
    });
    setPage(0);
  }

  function reset() {
    setDraft({ action: "", entityType: "", from: "", to: "" });
    setApplied({});
    setPage(0);
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile icon={ScrollText} label="Total events" value={formatNumber(summary.data?.total ?? 0)} />
        <StatTile
          icon={ListChecks}
          label="Distinct actions"
          value={formatNumber(summary.data?.by_action.length ?? 0)}
        />
        <StatTile
          icon={Activity}
          label="Entity types"
          value={formatNumber(summary.data?.by_entity.length ?? 0)}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Events by action">
          <MiniBarList
            items={(summary.data?.by_action ?? []).map((a) => ({ label: a.action, value: a.count }))}
          />
        </SectionCard>
        <SectionCard title="Events by entity">
          <MiniBarList
            items={(summary.data?.by_entity ?? []).map((e) => ({
              label: e.entity_type,
              value: e.count,
            }))}
          />
        </SectionCard>
      </div>

      <SectionCard
        title="Audit trail"
        description="Every recorded platform event across all organisations."
        actions={<ExportButton filename="audit-log" rows={exportRows} />}
      >
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor="f-action">Action</Label>
            <Input
              id="f-action"
              placeholder="e.g. emergency_event.created"
              value={draft.action}
              onChange={(e) => setDraft({ ...draft, action: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-entity">Entity type</Label>
            <Input
              id="f-entity"
              placeholder="e.g. escalation"
              value={draft.entityType}
              onChange={(e) => setDraft({ ...draft, entityType: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-from">From</Label>
            <Input
              id="f-from"
              type="date"
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="f-to">To</Label>
            <Input
              id="f-to"
              type="date"
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            />
          </div>
          <div className="flex items-end gap-2">
            <Button size="sm" onClick={apply}>
              Apply
            </Button>
            <Button size="sm" variant="outline" onClick={reset}>
              Reset
            </Button>
          </div>
        </div>

        {log.isLoading ? (
          <CenterNote>Loading…</CenterNote>
        ) : rows.length === 0 ? (
          <CenterNote>No matching events.</CenterNote>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-charcoal-ink/10 text-left text-xs text-charcoal-ink/50">
                    <th className="py-2 pr-4 font-medium">When</th>
                    <th className="py-2 pr-4 font-medium">Action</th>
                    <th className="py-2 pr-4 font-medium">Entity</th>
                    <th className="py-2 pr-4 font-medium">Actor</th>
                    <th className="py-2 pr-4 font-medium">Organisation</th>
                    <th className="py-2 pr-4 font-medium">Result</th>
                    <th className="py-2 pr-4 font-medium">Reason</th>
                    <th className="py-2 font-medium">Event</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-charcoal-ink/5 align-top">
                      <td className="whitespace-nowrap py-2 pr-4 text-charcoal-ink/60">
                        {formatWhen(r.created_at)}
                      </td>
                      <td className="py-2 pr-4 font-medium text-charcoal-ink/80">{r.action}</td>
                      <td className="py-2 pr-4 text-charcoal-ink/60">{r.entity_type ?? "—"}</td>
                      <td className="py-2 pr-4 text-charcoal-ink/60">{r.actor_name ?? "—"}</td>
                      <td className="py-2 pr-4 text-charcoal-ink/60">{r.organisation_name ?? "—"}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={RESULT_BADGE[r.result] ?? "grey"}>{r.result}</Badge>
                      </td>
                      <td className="py-2 pr-4 text-charcoal-ink/60">{r.reason ?? "—"}</td>
                      <td className="py-2 font-mono text-xs text-charcoal-ink/50">
                        {eventPreview(r.event)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-charcoal-ink/60">
              <span>
                {total.toLocaleString("en-NG")} event{total === 1 ? "" : "s"} · page {page + 1} of{" "}
                {pageCount}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(p - 1, 0))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </SectionCard>
    </div>
  );
}

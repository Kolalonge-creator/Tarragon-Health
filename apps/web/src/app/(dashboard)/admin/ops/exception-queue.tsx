"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadFailure } from "@/components/ui/load-failure";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";

const COLUMNS: DataTableColumn[] = [
  { header: "Severity", sortable: true },
  { header: "Domain", sortable: true },
  { header: "What's wrong", sortable: true, className: "min-w-56" },
  { header: "Who", sortable: true },
  { header: "Age", sortable: true, defaultDir: "desc" },
  { header: "Open", align: "right" },
];

export type OpsExceptionRow = {
  domain:
    | "alerts"
    | "appointments"
    | "referrals"
    | "laboratory"
    | "pharmacy"
    | "support"
    | "payments"
    | "incidents"
    | "providers"
    | "documents";
  entity_id: string;
  entity_type: string;
  severity: "critical" | "urgent" | "high";
  severity_rank: number;
  headline: string;
  detail: string;
  subject_name: string | null;
  subject_id: string | null;
  opened_at: string;
  age_hours: number;
  due_at: string | null;
  href: string;
};

const DOMAIN_LABEL: Record<OpsExceptionRow["domain"], string> = {
  alerts: "Alerts",
  appointments: "Appointments",
  referrals: "Referrals",
  laboratory: "Laboratory",
  pharmacy: "Pharmacy",
  support: "Support",
  payments: "Payments",
  incidents: "Incidents",
  providers: "Providers",
  documents: "Documents",
};

const SEVERITY_VARIANT: Record<OpsExceptionRow["severity"], "red" | "amber" | "blue"> = {
  critical: "red",
  urgent: "amber",
  high: "blue",
};

function ageText(hours: number): string {
  if (hours < 1) return "<1h";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * Modules 30.8-30.14 rendered as one triage list with a domain filter, per
 * the migration comment on public.ops_exception_queue: a small operations
 * team gets one habit to check rather than seven dashboards. Re-queries the
 * RPC client-side on domain change (cheap — it is the same jsonb function
 * the server already called for "all").
 */
export function ExceptionQueue({
  initialRows,
  loadFailed = false,
}: {
  initialRows: OpsExceptionRow[];
  /** True when the server's own ops_exception_queue read errored. Without it
   * an empty `initialRows` is ambiguous, and this component resolves that
   * ambiguity as "You're caught up" — the wrong answer for an operations
   * triage queue nobody else is watching. */
  loadFailed?: boolean;
}) {
  const [domain, setDomain] = useState<string>("all");
  const [rows, setRows] = useState(initialRows);
  const [refetchFailed, setRefetchFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: initialRows.length };
    for (const r of initialRows) c[r.domain] = (c[r.domain] ?? 0) + 1;
    return c;
  }, [initialRows]);

  const domains: Array<{ key: string; label: string }> = [
    { key: "all", label: "All" },
    ...(Object.keys(DOMAIN_LABEL) as OpsExceptionRow["domain"][])
      .filter((d) => (counts[d] ?? 0) > 0)
      .map((d) => ({ key: d, label: DOMAIN_LABEL[d] })),
  ];

  function selectDomain(next: string) {
    setDomain(next);
    startTransition(async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("ops_exception_queue", {
        p_domain: next === "all" ? undefined : next,
        p_limit: 200,
      });
      // Same rule as the initial read: a failed filter must empty the table
      // AND say so, never quietly leave an empty table reading as "clear".
      setRefetchFailed(error !== null);
      setRows(error ? [] : ((data ?? []) as OpsExceptionRow[]));
    });
  }

  if (loadFailed) {
    return (
      <LoadFailure>
        The exception queue could not be loaded, so nothing here is caught up: it is simply
        unknown. Reload the page before treating the board as clear.
      </LoadFailure>
    );
  }

  if (initialRows.length === 0) {
    return (
      <p className="rounded-lg bg-soft-sage/40 p-4 text-sm text-charcoal-ink/70">
        Nothing needs attention right now. You&apos;re caught up.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {domains.map((d) => (
          <Button
            key={d.key}
            type="button"
            size="sm"
            variant={domain === d.key ? "default" : "outline"}
            onClick={() => selectDomain(d.key)}
            disabled={pending}
          >
            {d.label}
            {counts[d.key] ? (
              <span className="ml-1.5 rounded-full bg-black/10 px-1.5 text-xs">
                {counts[d.key]}
              </span>
            ) : null}
          </Button>
        ))}
      </div>

      {refetchFailed && (
        <LoadFailure>
          That filter could not be loaded. The list below is empty because the query failed, not
          because the domain is clear. Pick a domain again or reload the page.
        </LoadFailure>
      )}

      {/* Arrives worst first (the queue's own order). A failed filter shows the error AND an empty table that says it
          was not loaded, never the empty-domain wording, so it cannot read as clear. */}
      <DataTable
        caption="Exception queue"
        columns={COLUMNS}
        rows={rows.map((r) => ({
          key: `${r.domain}-${r.entity_id}`,
          searchText: `${r.severity} ${DOMAIN_LABEL[r.domain]} ${r.headline} ${r.detail} ${r.subject_name ?? ""}`,
          sort: [r.severity_rank, DOMAIN_LABEL[r.domain], r.headline, r.subject_name, r.age_hours, null],
          cells: [
            <Badge key="sev" variant={SEVERITY_VARIANT[r.severity]}>{r.severity}</Badge>,
            <span key="dom" className="text-charcoal-ink/70">{DOMAIN_LABEL[r.domain]}</span>,
            <div key="what">
              <div className="font-medium text-charcoal-ink">{r.headline}</div>
              <div className="text-xs text-charcoal-ink/60">{r.detail}</div>
            </div>,
            <span key="who" className="text-charcoal-ink/70">{r.subject_name ?? "—"}</span>,
            <span key="age" className="text-charcoal-ink/70">{ageText(r.age_hours)}</span>,
            <Link key="open" href={r.href} className="text-sm font-medium text-brand-green hover:underline">Open</Link>,
          ],
        }))}
        searchLabel="Search the queue"
        emptyMessage={refetchFailed ? "Not loaded." : "Nothing open in this domain."}
        noun={{ one: "item", many: "items" }}
        className={pending ? "opacity-60" : undefined}
      />
    </div>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
    | "providers";
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
export function ExceptionQueue({ initialRows }: { initialRows: OpsExceptionRow[] }) {
  const [domain, setDomain] = useState<string>("all");
  const [rows, setRows] = useState(initialRows);
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
      const { data } = await supabase.rpc("ops_exception_queue", {
        p_domain: next === "all" ? null : next,
        p_limit: 200,
      });
      setRows((data ?? []) as OpsExceptionRow[]);
    });
  }

  if (initialRows.length === 0) {
    return (
      <p className="rounded-lg bg-soft-sage/40 p-4 text-sm text-charcoal-ink/70">
        Nothing needs attention right now — you&apos;re caught up.
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

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-charcoal-ink/10 text-left text-xs uppercase tracking-wide text-charcoal-ink/50">
              <th className="py-2 pr-3">Severity</th>
              <th className="py-2 pr-3">Domain</th>
              <th className="py-2 pr-3">What&apos;s wrong</th>
              <th className="py-2 pr-3">Who</th>
              <th className="py-2 pr-3">Age</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.domain}-${r.entity_id}`} className="border-b border-charcoal-ink/5">
                <td className="py-2.5 pr-3">
                  <Badge variant={SEVERITY_VARIANT[r.severity]}>{r.severity}</Badge>
                </td>
                <td className="py-2.5 pr-3 text-charcoal-ink/70">{DOMAIN_LABEL[r.domain]}</td>
                <td className="py-2.5 pr-3">
                  <div className="font-medium text-charcoal-ink">{r.headline}</div>
                  <div className="text-xs text-charcoal-ink/60">{r.detail}</div>
                </td>
                <td className="py-2.5 pr-3 text-charcoal-ink/70">{r.subject_name ?? "—"}</td>
                <td className="py-2.5 pr-3 text-charcoal-ink/70">{ageText(r.age_hours)}</td>
                <td className="py-2.5 text-right">
                  <Link href={r.href} className="text-sm font-medium text-brand-green hover:underline">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

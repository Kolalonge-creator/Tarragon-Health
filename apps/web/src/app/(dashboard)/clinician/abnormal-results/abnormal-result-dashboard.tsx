"use client";

import Link from "next/link";
import {
  useAbnormalResultDashboardCounts,
  useAbnormalResultDashboardCases,
} from "@/lib/queries/abnormal-result-dashboard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { SEVERITY_TILE_TINT } from "@/lib/worklist/severity-tile-tint";
import { SEMANTIC_ICON } from "@/lib/icons";
import { effectiveAlertLevel } from "@/lib/worklist/priority";
import { LEVEL_BADGE } from "@/lib/worklist/level-badge";

function formatSlaDue(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * §7.17 "Abnormal-result dashboard" — the exact
 * "Critical: N / Urgent: N / High: N / Routine: N, Unacknowledged: N /
 * Overdue: N" shape the spec describes, scoped to one org, plus the
 * underlying worklist with a unified Owner/Status column per case (§7.9/
 * §7.18). Distinct from /clinician/escalations (which is a working
 * clinician's own queue, ranked for triage) — this is the clinical-ops
 * view: what's open, who owns it, and whether anything is silently going
 * stale, all in one place.
 */
export function AbnormalResultDashboard({ organisationId }: { organisationId: string }) {
  const { data: counts, isLoading: countsLoading } = useAbnormalResultDashboardCounts(organisationId);
  const { data: cases, isLoading: casesLoading, isError } = useAbnormalResultDashboardCases();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile
          icon={SEMANTIC_ICON.escalation}
          tintClassName={SEVERITY_TILE_TINT.red.tintClassName}
          iconClassName={SEVERITY_TILE_TINT.red.iconClassName}
          label="Critical"
          value={countsLoading ? "…" : String(counts?.critical ?? 0)}
        />
        <StatTile
          icon={SEMANTIC_ICON.escalation}
          tintClassName={SEVERITY_TILE_TINT.amber.tintClassName}
          iconClassName={SEVERITY_TILE_TINT.amber.iconClassName}
          label="Urgent"
          value={countsLoading ? "…" : String(counts?.urgent ?? 0)}
        />
        <StatTile
          icon={SEMANTIC_ICON.escalation}
          tintClassName={SEVERITY_TILE_TINT.blue.tintClassName}
          iconClassName={SEVERITY_TILE_TINT.blue.iconClassName}
          label="High"
          value={countsLoading ? "…" : String(counts?.high ?? 0)}
        />
        <StatTile
          icon={SEMANTIC_ICON.escalation}
          tintClassName={SEVERITY_TILE_TINT.grey.tintClassName}
          iconClassName={SEVERITY_TILE_TINT.grey.iconClassName}
          label="Routine"
          value={countsLoading ? "…" : String(counts?.routine ?? 0)}
        />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatTile
          icon={SEMANTIC_ICON.escalation}
          tintClassName={SEVERITY_TILE_TINT.grey.tintClassName}
          iconClassName={SEVERITY_TILE_TINT.grey.iconClassName}
          label="Unacknowledged"
          value={countsLoading ? "…" : String(counts?.unacknowledged ?? 0)}
        />
        <StatTile
          icon={SEMANTIC_ICON.escalation}
          tintClassName={SEVERITY_TILE_TINT.red.tintClassName}
          iconClassName={SEVERITY_TILE_TINT.red.iconClassName}
          label="Overdue"
          value={countsLoading ? "…" : String(counts?.overdue ?? 0)}
        />
        <StatTile
          icon={SEMANTIC_ICON.escalation}
          tintClassName={SEVERITY_TILE_TINT.grey.tintClassName}
          iconClassName={SEVERITY_TILE_TINT.grey.iconClassName}
          label="Unclaimed (org pool)"
          value={countsLoading ? "…" : String(counts?.unclaimed ?? 0)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Open cases</CardTitle>
          <CardDescription>
            Every open case: owner, status, and whether it&apos;s overdue — nothing here should be
            capable of silently disappearing (§7.18).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {casesLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {isError && <p className="text-sm text-red-600">Could not load open cases.</p>}
          {cases && cases.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No open cases.</p>
          )}
          {cases && cases.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {cases.map((c) => {
                const level = effectiveAlertLevel(c);
                const badge = LEVEL_BADGE[level];
                const isOverdue = !!c.sla_due_at && new Date(c.sla_due_at) < new Date();
                return (
                  <li key={c.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        {isOverdue && <Badge variant="red">Overdue</Badge>}
                        <Badge variant="grey">{c.caseStatus.label}</Badge>
                      </div>
                      <p className="text-sm font-medium text-charcoal-ink">
                        <Link href={`/clinician/patients/${c.patient_id}`} className="hover:underline">
                          {c.patient?.full_name ?? "Unknown patient"}
                        </Link>
                        : {c.title}
                      </p>
                      <p className="text-xs text-charcoal-ink/60">Owner: {c.ownerName}</p>
                      {c.sla_due_at && (
                        <p className="text-xs text-charcoal-ink/60">
                          SLA due {formatSlaDue(c.sla_due_at)}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

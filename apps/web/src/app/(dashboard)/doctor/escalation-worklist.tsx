"use client";

import Link from "next/link";
import { useDoctorEscalations, useClaimEscalation } from "@/lib/queries/escalations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { LEVEL_BADGE, ESCALATION_STATUS_BADGE } from "@/lib/worklist/level-badge";
import { SEVERITY_TILE_TINT } from "@/lib/worklist/severity-tile-tint";
import { SEMANTIC_ICON } from "@/lib/icons";
import type { EscalationStatus } from "@tarragon/shared";

export function EscalationWorklist() {
  const { data, isLoading, isError } = useDoctorEscalations();
  const claim = useClaimEscalation();

  const countsByStatus = (data ?? []).reduce(
    (acc, escalation) => {
      acc[escalation.status] = (acc[escalation.status] ?? 0) + 1;
      return acc;
    },
    {} as Partial<Record<EscalationStatus, number>>
  );

  return (
    <div className="space-y-4">
      {data && data.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {(Object.keys(ESCALATION_STATUS_BADGE) as EscalationStatus[]).map((status) => {
            const badge = ESCALATION_STATUS_BADGE[status];
            const tint = SEVERITY_TILE_TINT[badge.variant ?? "grey"];
            return (
              <StatTile
                key={status}
                icon={SEMANTIC_ICON.escalation}
                tintClassName={tint.tintClassName}
                iconClassName={tint.iconClassName}
                label={badge.label}
                value={String(countsByStatus[status] ?? 0)}
              />
            );
          })}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Escalation worklist</CardTitle>
        </CardHeader>
        <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load the escalation worklist.</p>
        )}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No open escalations.</p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((escalation) => {
              const levelBadge = escalation.clinician_alert
                ? LEVEL_BADGE[escalation.clinician_alert.level]
                : null;
              const statusBadge = ESCALATION_STATUS_BADGE[escalation.status];

              return (
                <li key={escalation.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {levelBadge && (
                        <Badge variant={levelBadge.variant}>{levelBadge.label}</Badge>
                      )}
                      <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                    </div>
                    <p className="text-sm font-medium text-charcoal-ink">
                      <Link
                        href={`/doctor/escalations/${escalation.id}`}
                        className="hover:underline"
                      >
                        {escalation.patient?.full_name ?? "Unknown patient"}
                      </Link>{" "}
                      — {escalation.reason}
                    </p>
                  </div>
                  {escalation.assigned_doctor_id === null ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={claim.isPending}
                      onClick={() => claim.mutate(escalation.id)}
                    >
                      Claim
                    </Button>
                  ) : (
                    <span className="text-xs text-charcoal-ink/60">
                      {escalation.assigned_doctor?.full_name ?? "Claimed"}
                    </span>
                  )}
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

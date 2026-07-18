"use client";

import { useState } from "react";
import Link from "next/link";
import { useClinicianAlerts, useAcknowledgeAlert } from "@/lib/queries/clinician-alerts";
import { useEscalateAlert } from "@/lib/queries/escalations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatTile } from "@/components/ui/stat-tile";
import { LEVEL_BADGE } from "@/lib/worklist/level-badge";
import { SEVERITY_TILE_TINT } from "@/lib/worklist/severity-tile-tint";
import { SEMANTIC_ICON } from "@/lib/icons";
import type { EscalationLevel } from "@tarragon/shared";

const ESCALATABLE_LEVELS = new Set(["urgent_escalation", "emergency"]);

export function Worklist() {
  const { data, isLoading, isError } = useClinicianAlerts();
  const acknowledge = useAcknowledgeAlert();
  const escalate = useEscalateAlert();
  const [escalatingId, setEscalatingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const countsByLevel = (data ?? []).reduce(
    (acc, alert) => {
      acc[alert.level] = (acc[alert.level] ?? 0) + 1;
      return acc;
    },
    {} as Partial<Record<EscalationLevel, number>>
  );

  return (
    <div className="space-y-4">
      {data && data.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {(Object.keys(LEVEL_BADGE) as EscalationLevel[]).map((level) => {
            const badge = LEVEL_BADGE[level];
            const tint = SEVERITY_TILE_TINT[badge.variant ?? "grey"];
            return (
              <StatTile
                key={level}
                icon={SEMANTIC_ICON.escalation}
                tintClassName={tint.tintClassName}
                iconClassName={tint.iconClassName}
                label={badge.label}
                value={String(countsByLevel[level] ?? 0)}
              />
            );
          })}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Worklist</CardTitle>
        </CardHeader>
        <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load the worklist.</p>
        )}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No open alerts.</p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((alert) => {
              const badge = LEVEL_BADGE[alert.level];
              const isOverdue =
                !!alert.sla_due_at && new Date(alert.sla_due_at) < new Date();

              return (
                <li key={alert.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      {isOverdue && <Badge variant="red">Overdue</Badge>}
                    </div>
                    <p className="text-sm font-medium text-charcoal-ink">
                      <Link
                        href={`/clinician/patients/${alert.patient_id}`}
                        className="hover:underline"
                      >
                        {alert.patient?.full_name ?? "Unknown patient"}
                      </Link>{" "}
                      — {alert.title}
                    </p>
                    {alert.sla_due_at && (
                      <p className="text-xs text-charcoal-ink/60">
                        SLA due {new Date(alert.sla_due_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={acknowledge.isPending}
                        onClick={() => acknowledge.mutate(alert.id)}
                      >
                        Acknowledge
                      </Button>
                      {ESCALATABLE_LEVELS.has(alert.level) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setEscalatingId(escalatingId === alert.id ? null : alert.id)
                          }
                        >
                          Escalate to doctor
                        </Button>
                      )}
                    </div>
                    {escalatingId === alert.id && (
                      <div className="flex w-64 flex-col items-end gap-2">
                        <Input
                          placeholder="Reason for escalating"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <Button
                          size="sm"
                          disabled={escalate.isPending || reason.trim().length === 0}
                          onClick={() => {
                            escalate.mutate(
                              {
                                clinicianAlertId: alert.id,
                                patientId: alert.patient_id,
                                organisationId: alert.organisation_id,
                                reason: reason.trim(),
                              },
                              {
                                onSuccess: () => {
                                  setEscalatingId(null);
                                  setReason("");
                                },
                              }
                            );
                          }}
                        >
                          Confirm escalation
                        </Button>
                      </div>
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

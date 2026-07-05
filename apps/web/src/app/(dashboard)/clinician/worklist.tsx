"use client";

import { useClinicianAlerts, useAcknowledgeAlert } from "@/lib/queries/clinician-alerts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EscalationLevel } from "@tarragon/shared";

const LEVEL_BADGE: Record<EscalationLevel, { variant: BadgeProps["variant"]; label: string }> = {
  emergency: { variant: "red", label: "Emergency" },
  urgent_escalation: { variant: "amber", label: "Urgent escalation" },
  clinician_review: { variant: "blue", label: "Clinician review" },
  routine: { variant: "grey", label: "Routine" },
};

export function Worklist() {
  const { data, isLoading, isError } = useClinicianAlerts();
  const acknowledge = useAcknowledgeAlert();

  return (
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
                      {alert.patient?.full_name ?? "Unknown patient"} — {alert.title}
                    </p>
                    {alert.sla_due_at && (
                      <p className="text-xs text-charcoal-ink/60">
                        SLA due {new Date(alert.sla_due_at).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={acknowledge.isPending}
                    onClick={() => acknowledge.mutate(alert.id)}
                  >
                    Acknowledge
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

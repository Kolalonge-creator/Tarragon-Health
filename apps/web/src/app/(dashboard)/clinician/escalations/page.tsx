"use client";

import Link from "next/link";
import { useOrgEscalations } from "@/lib/queries/escalations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LEVEL_BADGE, ESCALATION_STATUS_BADGE } from "@/lib/worklist/level-badge";

export default function ClinicianEscalationsPage() {
  const { data, isLoading, isError } = useOrgEscalations();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Escalations</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && (
          <p className="text-sm text-red-600">Could not load escalations.</p>
        )}
        {data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No escalations yet.</p>
        )}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((escalation) => {
              const statusBadge = ESCALATION_STATUS_BADGE[escalation.status];
              const levelBadge = escalation.clinician_alert
                ? LEVEL_BADGE[escalation.clinician_alert.level]
                : null;

              return (
                <li key={escalation.id} className="space-y-1 py-3">
                  <div className="flex items-center gap-2">
                    {levelBadge && (
                      <Badge variant={levelBadge.variant}>{levelBadge.label}</Badge>
                    )}
                    <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                  </div>
                  <p className="text-sm font-medium text-charcoal-ink">
                    <Link
                      href={`/clinician/patients/${escalation.patient_id}`}
                      className="hover:underline"
                    >
                      {escalation.patient?.full_name ?? "Unknown patient"}
                    </Link>{" "}
                    — {escalation.reason}
                  </p>
                  <p className="text-xs text-charcoal-ink/60">
                    Assigned to {escalation.assigned_doctor?.full_name ?? "Unclaimed"} · raised{" "}
                    {new Date(escalation.created_at).toLocaleString()}
                  </p>
                  {escalation.resolution_note && (
                    <p className="text-xs text-charcoal-ink/60">
                      Resolution: {escalation.resolution_note}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

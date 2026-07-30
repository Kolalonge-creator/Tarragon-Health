"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useClinicianAlerts, useAcknowledgeAlert } from "@/lib/queries/clinician-alerts";
import { useEscalateAlert } from "@/lib/queries/escalations";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatTile } from "@/components/ui/stat-tile";
import { CaseBriefCard } from "@/components/case-brief-card";
import { LEVEL_BADGE } from "@/lib/worklist/level-badge";
import { SEVERITY_TILE_TINT } from "@/lib/worklist/severity-tile-tint";
import { effectiveAlertLevel } from "@/lib/worklist/priority";
import { SEMANTIC_ICON } from "@/lib/icons";
import type { EscalationLevel } from "@tarragon/shared";

const ESCALATABLE_LEVELS = new Set(["urgent_escalation", "emergency"]);

// A bare toLocaleString() resolves the server's locale on first render and
// the browser's on hydration -- a real mismatch caught live-verifying the
// case-brief card (server "30/07/2026, 13:19:30" vs. client "7/30/2026,
// 1:19:30 PM"). Same fixed-locale fix applied here for the SLA line.
function formatSlaDue(value: string): string {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Worklist() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useClinicianAlerts();
  const acknowledge = useAcknowledgeAlert();
  const escalate = useEscalateAlert();
  const [escalatingId, setEscalatingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [expandedBriefId, setExpandedBriefId] = useState<string | null>(null);

  const countsByLevel = (data ?? []).reduce(
    (acc, alert) => {
      const level = effectiveAlertLevel(alert);
      acc[level] = (acc[level] ?? 0) + 1;
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
          <CardDescription>
            Ranked by severity, then by how close each case is to breaching its SLA.
          </CardDescription>
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
              const level = effectiveAlertLevel(alert);
              const badge = LEVEL_BADGE[level];
              const isOverridden = !!alert.override_level;
              const isOverdue =
                !!alert.sla_due_at && new Date(alert.sla_due_at) < new Date();
              const isBriefExpanded = expandedBriefId === alert.id;

              return (
                <li key={alert.id} className="space-y-3 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        {isOverridden && <Badge variant="grey">Overridden</Badge>}
                        {isOverdue && <Badge variant="red">Overdue</Badge>}
                      </div>
                      <p className="text-sm font-medium text-charcoal-ink">
                        <Link
                          href={`/clinician/patients/${alert.patient_id}`}
                          className="hover:underline"
                        >
                          {alert.patient?.full_name ?? "Unknown patient"}
                        </Link>
                        : {alert.title}
                      </p>
                      {alert.sla_due_at && (
                        <p className="text-xs text-charcoal-ink/60">
                          SLA due {formatSlaDue(alert.sla_due_at)}
                        </p>
                      )}
                      <button
                        type="button"
                        className="text-xs text-brand-green hover:underline"
                        onClick={() => setExpandedBriefId(isBriefExpanded ? null : alert.id)}
                      >
                        {isBriefExpanded ? "Hide AI summary" : "AI summary"}
                      </button>
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
                        {ESCALATABLE_LEVELS.has(level) && (
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
                  </div>
                  {isBriefExpanded && (
                    <CaseBriefCard
                      clinicianAlertId={alert.id}
                      initialBrief={
                        alert.case_brief
                          ? {
                              status: alert.case_brief.status,
                              summaryText: alert.case_brief.summary_text,
                              suggestedActionText: alert.case_brief.suggested_action_text,
                              generatedAt: alert.case_brief.generated_at,
                            }
                          : null
                      }
                      onGenerated={() =>
                        queryClient.invalidateQueries({ queryKey: ["clinician-alerts"] })
                      }
                    />
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

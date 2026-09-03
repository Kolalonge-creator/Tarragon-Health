"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import {
  useClinicianAlerts,
  useAcknowledgeAlert,
  useSnoozeAlert,
  useResolveAlert,
  useAlertTrend,
  type AlertResolutionOutcome,
} from "@/lib/queries/clinician-alerts";
import { useEscalateAlert } from "@/lib/queries/escalations";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { StatTile } from "@/components/ui/stat-tile";
import { CaseBriefCard } from "@/components/case-brief-card";
import { LEVEL_BADGE } from "@/lib/worklist/level-badge";
import { SEVERITY_TILE_TINT } from "@/lib/worklist/severity-tile-tint";
import { effectiveAlertLevel } from "@/lib/worklist/priority";
import { SEMANTIC_ICON } from "@/lib/icons";
import type { EscalationLevel } from "@tarragon/shared";

const ESCALATABLE_LEVELS = new Set(["urgent_escalation", "emergency"]);

const RESOLUTION_OUTCOME_LABEL: Record<AlertResolutionOutcome, string> = {
  true_positive: "True positive (real concern)",
  false_positive: "False positive",
  duplicate: "Duplicate of another alert",
  no_action_needed: "No action needed",
};

function formatDateOnly(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

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
  const snooze = useSnoozeAlert();
  const resolve = useResolveAlert();
  const [escalatingId, setEscalatingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [expandedBriefId, setExpandedBriefId] = useState<string | null>(null);
  const [expandedWhyId, setExpandedWhyId] = useState<string | null>(null);
  const [expandedTrendId, setExpandedTrendId] = useState<string | null>(null);
  const [snoozingId, setSnoozingId] = useState<string | null>(null);
  const [snoozeDate, setSnoozeDate] = useState("");
  const [snoozeReason, setSnoozeReason] = useState("");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionAction, setResolutionAction] = useState("");
  const [resolutionOutcome, setResolutionOutcome] = useState<AlertResolutionOutcome>("true_positive");

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
      {/* One summary row, in the same vocabulary (LEVEL_BADGE) as the badge
          on every row below it — a doctor scanning "Emergency: 1" up here
          should see that exact word again on the case, not a differently-
          bucketed "URGENT" that doesn't appear anywhere else on the page. */}
      {data && data.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
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
            Ranked by severity first, then by SLA, abnormal results, repeat escalations and case
            complexity. Every case shows why it sits where it does.
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
              const isWhyExpanded = expandedWhyId === alert.id;
              const isTrendExpanded = expandedTrendId === alert.id;
              const isImportant = alert.severity >= 2;

              return (
                <li key={alert.id} className="space-y-3 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        <Badge variant="grey">
                          {alert.category.replace(/_/g, " ")} · {alert.type_code.replace(/_/g, " ")}
                        </Badge>
                        {isOverridden && <Badge variant="grey">Overridden</Badge>}
                        {isOverdue && <Badge variant="red">Overdue</Badge>}
                        {alert.duplicate_of && <Badge variant="grey">Possible duplicate</Badge>}
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
                      {/* 8.4: every alert's ownership, always visible — never just implied. */}
                      <p className="text-xs text-charcoal-ink/60">
                        Owner: {alert.responsible_clinician?.full_name ?? "Unassigned"}
                        {alert.backup_clinician && ` · Backup: ${alert.backup_clinician.full_name}`}
                      </p>
                      {/*
                        The ranking's own reason, always on screen. A triage
                        order a doctor cannot see the reasoning for is one they
                        have to either trust blindly or ignore — and the second
                        is what actually happens.
                      */}
                      <p className="text-xs font-medium text-charcoal-ink/70">
                        {alert.triage.headline}
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          className="text-xs text-brand-green hover:underline"
                          onClick={() => setExpandedBriefId(isBriefExpanded ? null : alert.id)}
                        >
                          {isBriefExpanded ? "Hide AI summary" : "AI summary"}
                        </button>
                        <button
                          type="button"
                          className="text-xs text-charcoal-ink/60 hover:underline"
                          onClick={() => setExpandedWhyId(isWhyExpanded ? null : alert.id)}
                        >
                          {isWhyExpanded ? "Hide ranking" : "Why this rank?"}
                        </button>
                        <button
                          type="button"
                          className="text-xs text-charcoal-ink/60 hover:underline"
                          onClick={() => setExpandedTrendId(isTrendExpanded ? null : alert.id)}
                        >
                          {isTrendExpanded ? "Hide previous trend" : "Previous trend"}
                        </button>
                      </div>
                      {isTrendExpanded && (
                        <AlertTrendPanel
                          patientId={alert.patient_id}
                          typeCode={alert.type_code}
                          excludeAlertId={alert.id}
                        />
                      )}
                      {isWhyExpanded && (
                        <ul className="space-y-0.5 rounded-md bg-charcoal-ink/[0.03] p-2">
                          {alert.triage.factors.map((factor) => (
                            <li
                              key={factor.key}
                              className="flex justify-between gap-4 text-xs text-charcoal-ink/70"
                            >
                              <span>{factor.label}</span>
                              <span className="tabular-nums">
                                {factor.points > 0 ? "+" : ""}
                                {factor.points}
                              </span>
                            </li>
                          ))}
                        </ul>
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
                        {acknowledge.isError && acknowledge.variables === alert.id && (
                          <p className="max-w-48 text-xs text-red-600">
                            {(acknowledge.error as Error).message}
                          </p>
                        )}
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
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSnoozingId(snoozingId === alert.id ? null : alert.id);
                            setResolvingId(null);
                          }}
                        >
                          Snooze
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setResolvingId(resolvingId === alert.id ? null : alert.id);
                            setSnoozingId(null);
                          }}
                        >
                          Resolve
                        </Button>
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
                      {/*
                        8.10: snoozing always requires a reason and always
                        creates a real follow-up task (server-enforced by
                        clinician_alerts_snooze_requires_reason and
                        private.stamp_clinician_alert_lifecycle) — the date
                        input can't be left blank either, so both halves of
                        "requires an appropriate reason and creates a future
                        task" have a real UI gate, not just a DB one.
                      */}
                      {snoozingId === alert.id && (
                        <div className="flex w-64 flex-col items-end gap-2">
                          <Input
                            type="date"
                            min={new Date().toISOString().slice(0, 10)}
                            value={snoozeDate}
                            onChange={(e) => setSnoozeDate(e.target.value)}
                          />
                          <Input
                            placeholder="Reason for snoozing"
                            value={snoozeReason}
                            onChange={(e) => setSnoozeReason(e.target.value)}
                          />
                          {snooze.isError && (
                            <p className="text-xs text-red-600">{(snooze.error as Error).message}</p>
                          )}
                          <Button
                            size="sm"
                            disabled={snooze.isPending || !snoozeDate || snoozeReason.trim().length === 0}
                            onClick={() => {
                              snooze.mutate(
                                {
                                  alertId: alert.id,
                                  snoozeUntil: new Date(`${snoozeDate}T09:00:00`).toISOString(),
                                  reason: snoozeReason.trim(),
                                },
                                {
                                  onSuccess: () => {
                                    setSnoozingId(null);
                                    setSnoozeDate("");
                                    setSnoozeReason("");
                                  },
                                }
                              );
                            }}
                          >
                            Confirm snooze
                          </Button>
                        </div>
                      )}
                      {/*
                        8.12: resolution without a documented action is
                        restricted for important (severity>=2) alerts —
                        clinician_alerts_resolution_requires_documentation
                        (DB CHECK) is the real enforcement; disabling Confirm
                        here is just the friendly pre-flight.
                      */}
                      {resolvingId === alert.id && (
                        <div className="flex w-72 flex-col items-end gap-2">
                          <Textarea
                            className="text-sm"
                            placeholder="Action taken"
                            rows={2}
                            value={resolutionAction}
                            onChange={(e) => setResolutionAction(e.target.value)}
                          />
                          <div className="flex w-full flex-col items-end gap-1">
                            <Label htmlFor={`resolution-outcome-${alert.id}`} className="sr-only">
                              Outcome
                            </Label>
                            <Select
                              id={`resolution-outcome-${alert.id}`}
                              value={resolutionOutcome}
                              onChange={(e) =>
                                setResolutionOutcome(e.target.value as AlertResolutionOutcome)
                              }
                            >
                              {(Object.keys(RESOLUTION_OUTCOME_LABEL) as AlertResolutionOutcome[]).map(
                                (outcome) => (
                                  <option key={outcome} value={outcome}>
                                    {RESOLUTION_OUTCOME_LABEL[outcome]}
                                  </option>
                                )
                              )}
                            </Select>
                          </div>
                          {resolve.isError && (
                            <p className="text-xs text-red-600">{(resolve.error as Error).message}</p>
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                resolve.isPending ||
                                (isImportant && resolutionAction.trim().length === 0)
                              }
                              onClick={() => {
                                resolve.mutate(
                                  {
                                    alertId: alert.id,
                                    resolutionAction: resolutionAction.trim(),
                                    resolutionOutcome,
                                  },
                                  {
                                    onSuccess: () => {
                                      setResolvingId(null);
                                      setResolutionAction("");
                                    },
                                  }
                                );
                              }}
                            >
                              Resolve
                            </Button>
                            <Button
                              size="sm"
                              disabled={
                                resolve.isPending ||
                                (isImportant && resolutionAction.trim().length === 0)
                              }
                              onClick={() => {
                                resolve.mutate(
                                  {
                                    alertId: alert.id,
                                    resolutionAction: resolutionAction.trim(),
                                    resolutionOutcome,
                                    close: true,
                                  },
                                  {
                                    onSuccess: () => {
                                      setResolvingId(null);
                                      setResolutionAction("");
                                    },
                                  }
                                );
                              }}
                            >
                              Resolve &amp; close
                            </Button>
                          </div>
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
                              draftReviewNote: alert.case_brief.draft_review_note,
                              protocolVersion: alert.case_brief.protocol_version
                                ? {
                                    title: alert.case_brief.protocol_version.title,
                                    versionNumber:
                                      alert.case_brief.protocol_version.version_number,
                                  }
                                : null,
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

/**
 * 8.9's "previous trend" panel: prior alerts of the same type for this
 * patient, so a clinician can see at a glance whether this is a one-off or
 * part of a pattern before deciding on an action.
 */
function AlertTrendPanel({
  patientId,
  typeCode,
  excludeAlertId,
}: {
  patientId: string;
  typeCode: string;
  excludeAlertId: string;
}) {
  const { data, isLoading } = useAlertTrend(patientId, typeCode, excludeAlertId);

  if (isLoading) {
    return <p className="text-xs text-charcoal-ink/60">Loading trend…</p>;
  }
  if (!data || data.length === 0) {
    return (
      <p className="rounded-md bg-charcoal-ink/[0.03] p-2 text-xs text-charcoal-ink/60">
        No other {typeCode.replace(/_/g, " ")} alerts for this patient in the last 90 days.
      </p>
    );
  }

  return (
    <ul className="space-y-1 rounded-md bg-charcoal-ink/[0.03] p-2">
      {data.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-4 text-xs text-charcoal-ink/70">
          <span>{formatDateOnly(row.created_at)}</span>
          <span className="flex-1 truncate px-2">{row.title}</span>
          <Badge variant={row.status === "resolved" || row.status === "closed" ? "grey" : "amber"}>
            {row.status}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

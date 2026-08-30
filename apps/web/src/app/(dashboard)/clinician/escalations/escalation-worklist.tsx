"use client";

import Link from "next/link";
import { useDoctorEscalations, useClaimEscalation } from "@/lib/queries/escalations";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { LEVEL_BADGE, ESCALATION_STATUS_BADGE } from "@/lib/worklist/level-badge";
import { RESULT_STATUS_BADGE } from "@/lib/worklist/result-status-badge";
import { SEVERITY_TILE_TINT } from "@/lib/worklist/severity-tile-tint";
import { effectiveAlertLevel, requiresEmergencyAuthority } from "@/lib/worklist/priority";
import { SEMANTIC_ICON } from "@/lib/icons";
import type { EscalationStatus } from "@tarragon/shared";

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * `canHandleEmergency` mirrors private.can_handle_emergency_escalation --
 * resolved server-side from the caller's own clinical_staff row and passed
 * down, the same shape as MedicationsList's canConfirmRefill. It only
 * decides whether a row shows a Claim button or a plain-language
 * explanation; the DB trigger is what actually enforces the rule.
 *
 * `canClaim` mirrors isClinicalTier(staff) — false for a Care Coordinator,
 * who may raise an escalation but must never claim/resolve one (see the
 * page-level comment). Checked first, ahead of canHandleEmergency, so a
 * non-clinical caller always sees the same "only a doctor" explanation
 * regardless of the case's severity.
 */
export function EscalationWorklist({
  canHandleEmergency,
  canClaim,
}: {
  canHandleEmergency: boolean;
  canClaim: boolean;
}) {
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
          <CardDescription>
            Ranked by severity, then by how close each case is to breaching its SLA, not by
            when it was raised.
          </CardDescription>
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
              const effectiveLevel = escalation.clinician_alert
                ? effectiveAlertLevel(escalation.clinician_alert)
                : null;
              const levelBadge = effectiveLevel ? LEVEL_BADGE[effectiveLevel] : null;
              const isOverridden = !!escalation.clinician_alert?.override_level;
              // Every doctor tier can see and work every case (unified
              // access, 2026-07-31) — but claiming an emergency-level case
              // specifically needs a Tier 2+ doctor or the Clinical
              // Director. requiresEmergencyAuthority is deliberately not
              // effectiveAlertLevel(...) === "emergency" — see its own
              // doc comment for why a downward override must not unlock a
              // Tier 1's own claim.
              const isEmergencyLocked =
                requiresEmergencyAuthority(escalation.clinician_alert) && !canHandleEmergency;
              const isOverdue =
                !!escalation.clinician_alert?.sla_due_at &&
                new Date(escalation.clinician_alert.sla_due_at) < new Date();
              const resultBadge = escalation.clinician_alert?.screening_result
                ? RESULT_STATUS_BADGE[escalation.clinician_alert.screening_result.result_status]
                : null;
              const statusBadge = ESCALATION_STATUS_BADGE[escalation.status];
              const caseOwnerName =
                escalation.clinician_alert?.responsible_clinician?.full_name ??
                escalation.clinician_alert?.backup_clinician?.full_name ??
                "Unassigned";

              return (
                <li key={escalation.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {resultBadge && (
                        <Badge variant={resultBadge.variant}>{resultBadge.label}</Badge>
                      )}
                      {levelBadge && (
                        <Badge variant={levelBadge.variant}>{levelBadge.label}</Badge>
                      )}
                      {isOverridden && (
                        <Badge variant="grey">Overridden</Badge>
                      )}
                      {isOverdue && <Badge variant="red">Overdue</Badge>}
                      <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                    </div>
                    <p className="text-sm font-medium text-charcoal-ink">
                      <Link
                        href={`/clinician/escalations/${escalation.id}`}
                        className="hover:underline"
                      >
                        {escalation.patient?.full_name ?? "Unknown patient"}
                      </Link>{": "}
                      {escalation.reason}
                    </p>
                    <p className="text-xs text-charcoal-ink/60">
                      Raised {timeAgo(escalation.created_at)} · Case owner: {caseOwnerName}
                    </p>
                  </div>
                  {escalation.assigned_doctor_id === null ? (
                    !canClaim ? (
                      <span className="max-w-[14rem] text-right text-xs text-charcoal-ink/60">
                        Only a doctor can claim this case
                      </span>
                    ) : isEmergencyLocked ? (
                      <span className="max-w-[14rem] text-right text-xs text-charcoal-ink/60">
                        Needs a Tier 2+ doctor or the Clinical Director to claim
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={claim.isPending}
                        onClick={() => claim.mutate(escalation.id)}
                      >
                        Claim
                      </Button>
                    )
                  ) : (
                    <span className="text-xs text-charcoal-ink/60">
                      Claimed by: {escalation.assigned_doctor?.full_name ?? "Claimed"}
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

"use client";

import Link from "next/link";
import {
  useOperationsQueueAlerts,
  useOverdueReferralGaps,
  useCareGapCounts,
  bucketForAlert,
  TIER_LABEL,
  type OperationsQueueAlert,
  type OperationsQueueBucket,
} from "@/lib/queries/operations-queue";
import { severityBucket } from "@/lib/queries/clinician-alerts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { SEVERITY_TILE_TINT } from "@/lib/worklist/severity-tile-tint";
import { SEMANTIC_ICON } from "@/lib/icons";

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function slaLabel(slaDueAt: string | null): { text: string; overdue: boolean } | null {
  if (!slaDueAt) return null;
  const diffMs = new Date(slaDueAt).getTime() - Date.now();
  const overdue = diffMs < 0;
  const mins = Math.round(Math.abs(diffMs) / 60_000);
  const text =
    mins < 60
      ? `${mins}m`
      : mins < 60 * 24
        ? `${Math.round(mins / 60)}h`
        : `${Math.round(mins / (60 * 24))}d`;
  return { text: overdue ? `${text} overdue` : `${text} left`, overdue };
}

const TIER_BADGE_VARIANT: Record<ReturnType<typeof severityBucket>, BadgeProps["variant"]> = {
  urgent: "red",
  high: "amber",
  routine: "grey",
};

const STATUS_BADGE: Record<OperationsQueueAlert["status"], { variant: BadgeProps["variant"]; label: string }> = {
  open: { variant: "amber", label: "Open" },
  acknowledged: { variant: "blue", label: "Acknowledged" },
  snoozed: { variant: "grey", label: "Snoozed" },
  resolved: { variant: "green", label: "Resolved" },
  closed: { variant: "grey", label: "Closed" },
};

const BUCKET_CONFIG: Record<OperationsQueueBucket, { title: string; description: string }> = {
  critical_result: {
    title: "Critical result",
    description: "Abnormal results, deterioration, and symptom escalations (category: clinical).",
  },
  medication_concern: {
    title: "Medication concern",
    description: "Adherence problems, refill-due, interactions, pharmacy problems.",
  },
  specialist_delay: {
    title: "Specialist delay",
    description: "Declined referrals, plus referrals open 30+ days with no treatment plan received yet.",
  },
  overdue_follow_up: {
    title: "Overdue follow-up",
    description: "Missed appointments, overdue tasks, overdue monitoring.",
  },
  other: {
    title: "Other operational alerts",
    description: "Everything else the alert taxonomy raises -- shown rather than hidden.",
  },
};

const BUCKET_ORDER: OperationsQueueBucket[] = [
  "critical_result",
  "medication_concern",
  "specialist_delay",
  "overdue_follow_up",
  "other",
];

function AlertRow({ alert }: { alert: OperationsQueueAlert }) {
  const tier = severityBucket(alert.severity ?? 0);
  const sla = slaLabel(alert.sla_due_at);
  const owner = alert.responsible_clinician?.full_name ?? alert.backup_clinician?.full_name ?? null;
  const status = STATUS_BADGE[alert.status];

  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Badge variant={TIER_BADGE_VARIANT[tier]}>{TIER_LABEL[tier]}</Badge>
          {alert.type_code && <Badge variant="grey">{alert.type_code.replace(/_/g, " ")}</Badge>}
          <Badge variant={status.variant}>{status.label}</Badge>
          {sla && <Badge variant={sla.overdue ? "red" : "grey"}>{sla.text}</Badge>}
        </div>
        <p className="text-sm font-medium text-charcoal-ink">
          <Link href={`/clinician/patients/${alert.patient_id}`} className="hover:underline">
            {alert.patient?.full_name ?? "Unknown patient"}
          </Link>
          {": "}
          {alert.title}
        </p>
        <p className="text-xs text-charcoal-ink/60">
          Raised {timeAgo(alert.created_at)} · Owner: {owner ?? "Unassigned"}
        </p>
      </div>
    </li>
  );
}

function BucketSection({ bucket, alerts }: { bucket: OperationsQueueBucket; alerts: OperationsQueueAlert[] }) {
  const config = BUCKET_CONFIG[bucket];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{config.title}</CardTitle>
          <span className="text-sm font-semibold text-charcoal-ink/70">{alerts.length}</span>
        </div>
        <CardDescription>{config.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">Nothing open in this category.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {alerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function OperationsQueueWorklist() {
  const { data: alerts, isLoading, isError } = useOperationsQueueAlerts();
  const { data: overdueReferrals } = useOverdueReferralGaps();
  const { data: gapCounts } = useCareGapCounts();

  const byBucket = BUCKET_ORDER.reduce(
    (acc, bucket) => {
      acc[bucket] = (alerts ?? []).filter((alert) => bucketForAlert(alert) === bucket);
      return acc;
    },
    {} as Record<OperationsQueueBucket, OperationsQueueAlert[]>
  );

  return (
    <div className="space-y-6">
      {gapCounts && gapCounts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Open care gaps</CardTitle>
            <CardDescription>
              For awareness only -- worked from the{" "}
              <Link href="/dashboard/care-coordinator" className="underline">
                care-coordinator outreach queue
              </Link>
              , not here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {gapCounts.map((g) => (
                <StatTile
                  key={g.gap_type}
                  icon={SEMANTIC_ICON.escalation}
                  tintClassName={SEVERITY_TILE_TINT.grey.tintClassName}
                  iconClassName={SEVERITY_TILE_TINT.grey.iconClassName}
                  label={g.gap_type.replace(/_/g, " ")}
                  value={String(g.count)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
      {isError && <p className="text-sm text-red-600">Could not load the operations queue.</p>}

      {alerts && (
        <div className="grid gap-6 lg:grid-cols-2">
          {BUCKET_ORDER.map((bucket) => (
            <BucketSection key={bucket} bucket={bucket} alerts={byBucket[bucket]} />
          ))}
        </div>
      )}

      {overdueReferrals && overdueReferrals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Overdue referrals (no alert raised yet)</CardTitle>
            <CardDescription>
              Specialist referrals open 30+ days with no treatment plan received -- from
              patient_care_gaps, distinct from the &ldquo;Specialist delay&rdquo; alerts above (those
              come from declined referrals).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-charcoal-ink/10">
              {overdueReferrals.map((gap) => (
                <li key={`${gap.patient_id}-${gap.detail.referral_id}`} className="flex items-center justify-between gap-4 py-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-charcoal-ink">
                      <Link href={`/clinician/patients/${gap.patient_id}`} className="hover:underline">
                        {gap.patient.full_name ?? "Unknown patient"}
                      </Link>
                      {gap.detail.specialist_type ? `: ${gap.detail.specialist_type.replace(/_/g, " ")}` : ""}
                    </p>
                    <p className="text-xs text-charcoal-ink/60">Open since {timeAgo(gap.opened_at)}</p>
                  </div>
                  {gap.detail.referral_number && (
                    <span className="text-xs text-charcoal-ink/60">{gap.detail.referral_number}</span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

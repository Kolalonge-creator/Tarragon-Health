"use client";

import { useState } from "react";
import {
  useAllChronicProgrammes,
  useConditionProtocols,
  useSetChronicProgrammeActive,
  useHtnQualityMetrics,
  type ChronicProgramme,
  type ConditionProtocol,
} from "@/lib/queries/chronic-programmes";
import { useCareManagementKpis } from "@/lib/queries/care-management-analytics";
import { useProtocolVersions, useCreateProtocolVersion } from "@/lib/queries/protocol-versions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConditionProtocolView } from "@/components/clinical/condition-protocol";

/** Inline "sign the WHO protocol" form — reuses useCreateProtocolVersion, which
 * enforces that the caller is the org's active Clinical Director. Signing
 * records an auditable protocol_versions row for the programme's protocol_slug,
 * which is exactly what the activation trigger checks for. */
function SignProtocolForm({
  programme,
  protocol,
  onSigned,
}: {
  programme: ChronicProgramme;
  protocol: ConditionProtocol | undefined;
  onSigned: () => void;
}) {
  const create = useCreateProtocolVersion();
  const [summary, setSummary] = useState(
    `Adopt WHO ${programme.name} protocol (${protocol?.source_reference ?? "WHO guidance"})`
  );

  return (
    <div className="space-y-2 rounded-md border border-charcoal-ink/10 bg-white p-3">
      <Label htmlFor={`sign-${programme.id}`}>Change summary (recorded on the signed version)</Label>
      <Input
        id={`sign-${programme.id}`}
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
      />
      {create.isError && (
        <p className="text-sm text-red-600">{(create.error as Error).message}</p>
      )}
      <Button
        disabled={create.isPending || summary.trim().length === 0}
        onClick={() =>
          create.mutate(
            {
              protocolId: programme.protocol_slug,
              title: `${programme.name}: WHO clinical protocol`,
              changeSummary: summary.trim(),
              content: protocol
                ? {
                    source: protocol.source,
                    source_reference: protocol.source_reference,
                    summary: protocol.summary,
                    prevention: protocol.prevention,
                    monitoring: protocol.monitoring,
                    investigations: protocol.investigations,
                    escalation: protocol.escalation,
                    follow_up: protocol.follow_up,
                  }
                : { note: "Signed without a seeded reference protocol." },
            },
            { onSuccess: onSigned }
          )
        }
      >
        {create.isPending ? "Signing…" : "Sign protocol"}
      </Button>
      <p className="text-xs text-charcoal-ink/50">
        Only the org&apos;s active Clinical Director can sign. Signing does not activate the
        condition on its own; you still switch it on below.
      </p>
    </div>
  );
}

/** H16 (§22) KPI snapshot — hypertension only, the only condition with the RPC built so far. */
function HtnQualityCard({ organisationId }: { organisationId: string | null | undefined }) {
  const { data, isLoading, isError } = useHtnQualityMetrics(organisationId);

  if (isLoading) return <p className="text-xs text-charcoal-ink/50">Loading KPIs…</p>;
  if (isError || !data) return null;

  const stats: Array<{ label: string; value: string | number; tone?: "red" | "amber" }> = [
    {
      label: "Control rate",
      value: data.control_rate_pct !== null ? `${data.control_rate_pct}%` : "—",
    },
    { label: "HTN patients", value: data.htn_patients },
    { label: "Open Priority-1 (red)", value: data.open_red_alerts, tone: "red" },
    { label: "Open amber review", value: data.open_amber_alerts, tone: "amber" },
    { label: "Emergencies (30d)", value: data.bp_emergencies_30d, tone: data.bp_emergencies_30d > 0 ? "red" : undefined },
    { label: "Missing expected readings", value: data.patients_missing_readings },
  ];

  return (
    <div className="rounded-md border border-charcoal-ink/10 bg-mist-grey/40 p-3">
      <p className="mb-2 text-xs font-medium text-charcoal-ink/60">
        Clinical-audit KPIs (§22): {data.htn_patients} enrolled patient
        {data.htn_patients === 1 ? "" : "s"}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded bg-white p-2">
            <p
              className={
                "text-lg font-semibold " +
                (s.tone === "red"
                  ? "text-red-600"
                  : s.tone === "amber"
                    ? "text-amber-600"
                    : "text-charcoal-ink")
              }
            >
              {s.value}
            </p>
            <p className="text-[11px] leading-tight text-charcoal-ink/60">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * §3.20's cross-programme analytics — enrolment, task completion, dropout,
 * and escalation across every chronic programme (not per-condition like
 * HtnQualityCard, so this renders once above the programme list, not once
 * per row).
 */
function CareManagementKpiCard({ organisationId }: { organisationId: string | null | undefined }) {
  const { data, isLoading, isError } = useCareManagementKpis(organisationId);

  if (isLoading) return <p className="text-xs text-charcoal-ink/50">Loading care management KPIs…</p>;
  if (isError || !data) return null;

  const stats: Array<{ label: string; value: string | number; tone?: "red" | "amber" }> = [
    {
      label: "Task completion (30d)",
      value: data.tasks_completion_rate_30d !== null ? `${data.tasks_completion_rate_30d}%` : "—",
    },
    {
      label: "Overdue tasks",
      value: data.tasks_overdue_now,
      tone: data.tasks_overdue_now > 0 ? "amber" : undefined,
    },
    {
      label: "High-priority overdue",
      value: data.tasks_high_priority_overdue,
      tone: data.tasks_high_priority_overdue > 0 ? "red" : undefined,
    },
    {
      label: "Escalated to clinician (30d)",
      value: data.care_task_escalations_30d,
      tone: data.care_task_escalations_30d > 0 ? "red" : undefined,
    },
    { label: "Goals achieved (30d)", value: data.goals_achieved_30d },
    { label: "Active goals", value: data.goals_active },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Care management</CardTitle>
        <CardDescription>
          Programme enrolment, task completion, and escalation across every chronic programme.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded bg-mist-grey/40 p-2">
              <p
                className={
                  "text-lg font-semibold " +
                  (s.tone === "red"
                    ? "text-red-600"
                    : s.tone === "amber"
                      ? "text-amber-600"
                      : "text-charcoal-ink")
                }
              >
                {s.value}
              </p>
              <p className="text-[11px] leading-tight text-charcoal-ink/60">{s.label}</p>
            </div>
          ))}
        </div>
        {data.programme_enrolments.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-charcoal-ink/60">Enrolment by programme</p>
            <ul className="divide-y divide-charcoal-ink/10 text-sm">
              {data.programme_enrolments.map((p) => (
                <li key={p.programme} className="flex items-center justify-between py-1">
                  <span className="text-charcoal-ink">{p.programme}</span>
                  <span className="text-xs text-charcoal-ink/60">
                    {p.enrolled} enrolled · {p.completed} completed · {p.withdrawn} withdrawn
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProgrammeRow({
  programme,
  protocol,
  isSigned,
  organisationId,
}: {
  programme: ChronicProgramme;
  protocol: ConditionProtocol | undefined;
  isSigned: boolean;
  organisationId: string | null | undefined;
}) {
  const setActive = useSetChronicProgrammeActive();
  const [showProtocol, setShowProtocol] = useState(false);
  const [showSign, setShowSign] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            {programme.name}
            {programme.is_active ? (
              <Badge variant="green">Active</Badge>
            ) : (
              <Badge variant="grey">Dormant</Badge>
            )}
            {programme.launch_priority === 1 && <Badge variant="blue">Launch</Badge>}
            {isSigned ? (
              <Badge variant="green">Protocol signed</Badge>
            ) : (
              <Badge variant="amber">Protocol unsigned</Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {programme.is_active ? (
              <Button
                variant="outline"
                onClick={() =>
                  setActive.mutate({ id: programme.id, isActive: false })
                }
                disabled={setActive.isPending}
              >
                Deactivate
              </Button>
            ) : (
              <Button
                onClick={() => setActive.mutate({ id: programme.id, isActive: true })}
                disabled={setActive.isPending || !isSigned}
                title={isSigned ? undefined : "Sign the protocol before activating"}
              >
                {setActive.isPending ? "…" : "Activate"}
              </Button>
            )}
          </div>
        </div>
        <CardDescription>{programme.short_description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-charcoal-ink/60">
          {programme.category} · reviews every {programme.review_cadence_months} months ·
          monitors {programme.monitoring_vitals.join(", ") || "—"}
        </p>

        {setActive.isError && (
          <p className="text-sm text-red-600">{(setActive.error as Error).message}</p>
        )}

        {programme.condition === "hypertension" && (
          <HtnQualityCard organisationId={organisationId} />
        )}

        <div className="flex flex-wrap gap-3 text-sm">
          {protocol && (
            <button
              type="button"
              className="font-medium text-brand-green hover:underline"
              onClick={() => setShowProtocol((v) => !v)}
            >
              {showProtocol ? "Hide WHO protocol" : "View WHO protocol"}
            </button>
          )}
          {!isSigned && (
            <button
              type="button"
              className="font-medium text-brand-green hover:underline"
              onClick={() => setShowSign((v) => !v)}
            >
              {showSign ? "Cancel signing" : "Sign protocol to enable activation"}
            </button>
          )}
        </div>

        {showProtocol && protocol && (
          <div className="rounded-md border border-charcoal-ink/10 bg-mist-grey/40 p-4">
            <ConditionProtocolView protocol={protocol} />
          </div>
        )}

        {showSign && !isSigned && (
          <SignProtocolForm
            programme={programme}
            protocol={protocol}
            onSigned={() => setShowSign(false)}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function ConditionsManager({
  organisationId,
}: {
  organisationId?: string | null;
}) {
  const programmes = useAllChronicProgrammes();
  const protocols = useConditionProtocols();
  const versions = useProtocolVersions();

  if (programmes.isLoading || protocols.isLoading || versions.isLoading) {
    return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  }
  if (programmes.isError || !programmes.data) {
    return <p className="text-sm text-red-600">Could not load chronic conditions.</p>;
  }

  const protocolByCondition = new Map(
    (protocols.data ?? []).map((p) => [p.condition, p])
  );
  const signedSlugs = new Set((versions.data ?? []).map((v) => v.protocol_id));

  return (
    <div className="space-y-4">
      <CareManagementKpiCard organisationId={organisationId} />
      {programmes.data.map((programme) => (
        <ProgrammeRow
          key={programme.id}
          programme={programme}
          protocol={protocolByCondition.get(programme.condition)}
          isSigned={signedSlugs.has(programme.protocol_slug)}
          organisationId={organisationId}
        />
      ))}
    </div>
  );
}

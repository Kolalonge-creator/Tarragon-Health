"use client";

import { useActionState, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ACCEPTANCE_CRITERION_LABEL,
  AUTONOMY_LABEL,
  RISK_BADGE_VARIANT,
  RISK_LABEL,
  type AiDashboardSystem,
  type AiGovernanceDashboard,
} from "./dashboard-schema";
import {
  activateAiPromptVersionAction,
  resolveAiIncidentAction,
  setAiSystemEnabledAction,
  triageAiIncidentAction,
  type AiGovernanceActionState,
} from "./actions";

export interface AiSystemRow {
  id: string;
  system_code: string;
  name: string;
  purpose: string;
  owner_role: string;
  owner_profile_id: string | null;
  fallback_behaviour: string;
  code_reference: string | null;
  disabled_reason: string | null;
  disabled_at: string | null;
  runtime_governed: boolean;
  grandfather_note: string | null;
}

export interface AiIncidentRow {
  id: string;
  ai_system_id: string;
  interaction_id: string | null;
  reporter_kind: string;
  category: string;
  severity: string;
  status: string;
  description: string;
  clinical_review_summary: string | null;
  corrective_action: string | null;
  patient_harm_occurred: boolean | null;
  created_at: string;
  resolved_at: string | null;
}

export interface AiPromptVersionRow {
  id: string;
  ai_system_id: string;
  version: number;
  is_active: boolean;
  approved_at: string | null;
  change_summary: string | null;
  created_at: string;
}

export interface AiModelObservationRow {
  id: string;
  ai_system_id: string;
  observed_model_identifier: string;
  expected_model_identifier: string | null;
  is_expected: boolean;
  first_seen_at: string;
  last_seen_at: string;
  observation_count: number;
  acknowledged_at: string | null;
}

const SEVERITY_VARIANT: Record<string, "red" | "amber" | "blue" | "grey"> = {
  critical: "red",
  high: "red",
  moderate: "amber",
  low: "grey",
};

const OPEN_STATUSES = new Set(["open", "triaged", "investigating"]);

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function Metric({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-charcoal-ink/10 bg-white p-4">
      <p className="text-2xl font-semibold text-charcoal-ink">{value.toLocaleString("en-GB")}</p>
      <p className="text-sm text-charcoal-ink/70">{label}</p>
      {hint && <p className="mt-1 text-xs text-charcoal-ink/50">{hint}</p>}
    </div>
  );
}

function ActionFeedback({ state }: { state: AiGovernanceActionState }) {
  if (!state) return null;
  if (state.error) return <p className="mt-2 text-sm text-red-600">{state.error}</p>;
  if (state.success) return <p className="mt-2 text-sm text-brand-green">{state.success}</p>;
  return null;
}

function KillSwitchForm({ system, enabled }: { system: AiSystemRow; enabled: boolean }) {
  const [state, action, pending] = useActionState<AiGovernanceActionState, FormData>(
    setAiSystemEnabledAction,
    undefined
  );
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div>
        <Button variant={enabled ? "outline" : "default"} size="sm" onClick={() => setOpen(true)}>
          {enabled ? "Switch off" : "Switch on"}
        </Button>
        <ActionFeedback state={state} />
      </div>
    );
  }

  return (
    <form action={action} className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3">
      <input type="hidden" name="systemId" value={system.id} />
      <input type="hidden" name="enabled" value={enabled ? "off" : "on"} />
      <Label htmlFor={`reason-${system.id}`}>
        {enabled
          ? "Why is this being switched off? Clinical operations will be told, along with what runs instead."
          : "Why is this being switched back on?"}
      </Label>
      <Textarea id={`reason-${system.id}`} name="reason" rows={2} required />
      {enabled && (
        <p className="text-xs text-charcoal-ink/60">
          What happens next: {system.fallback_behaviour}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : enabled ? "Confirm switch off" : "Confirm switch on"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <ActionFeedback state={state} />
    </form>
  );
}

function AcceptanceChecklist({ system }: { system: AiDashboardSystem }) {
  const entries = Object.entries(system.acceptance.criteria) as [
    keyof AiDashboardSystem["acceptance"]["criteria"],
    boolean,
  ][];

  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([key, met]) => (
        <Badge key={key} variant={met ? "green" : "amber"}>
          {met ? "✓" : "•"} {ACCEPTANCE_CRITERION_LABEL[key]}
        </Badge>
      ))}
    </div>
  );
}

function PromptActivationForm({ promptVersionId }: { promptVersionId: string }) {
  const [state, action, pending] = useActionState<AiGovernanceActionState, FormData>(
    activateAiPromptVersionAction,
    undefined
  );
  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="promptVersionId" value={promptVersionId} />
      <Textarea name="note" rows={2} placeholder="What changed, and what was reviewed (optional)" />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Activating…" : "Approve & activate"}
      </Button>
      <ActionFeedback state={state} />
    </form>
  );
}

function IncidentTriageForm({ incidentId }: { incidentId: string }) {
  const [state, action, pending] = useActionState<AiGovernanceActionState, FormData>(
    triageAiIncidentAction,
    undefined
  );
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="incidentId" value={incidentId} />
      <div>
        <Label htmlFor={`sev-${incidentId}`}>Severity</Label>
        <Select id={`sev-${incidentId}`} name="severity" defaultValue="moderate">
          <option value="low">Low</option>
          <option value="moderate">Moderate</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </Select>
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Triage"}
      </Button>
      <ActionFeedback state={state} />
    </form>
  );
}

function IncidentCloseForm({ incidentId }: { incidentId: string }) {
  const [state, action, pending] = useActionState<AiGovernanceActionState, FormData>(
    resolveAiIncidentAction,
    undefined
  );
  return (
    <form action={action} className="space-y-2 rounded-lg border border-charcoal-ink/10 p-3">
      <input type="hidden" name="incidentId" value={incidentId} />
      <div>
        <Label htmlFor={`summary-${incidentId}`}>Clinical review summary</Label>
        <Textarea id={`summary-${incidentId}`} name="clinicalReviewSummary" rows={3} required />
      </div>
      <div>
        <Label htmlFor={`corrective-${incidentId}`}>Corrective action (optional)</Label>
        <Textarea id={`corrective-${incidentId}`} name="correctiveAction" rows={2} />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor={`harm-${incidentId}`}>Patient harm</Label>
          <Select id={`harm-${incidentId}`} name="patientHarmOccurred" defaultValue="no">
            <option value="no">No harm</option>
            <option value="yes">Harm occurred</option>
          </Select>
        </div>
        <div className="min-w-[16rem] flex-1">
          <Label htmlFor={`harmdesc-${incidentId}`}>If harm occurred, describe it</Label>
          <Textarea id={`harmdesc-${incidentId}`} name="harmDescription" rows={2} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" name="status" value="resolved" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Resolve"}
        </Button>
        <Button
          type="submit"
          name="status"
          value="dismissed"
          size="sm"
          variant="outline"
          disabled={pending}
        >
          Not a safety problem
        </Button>
      </div>
      <ActionFeedback state={state} />
    </form>
  );
}

export function AiGovernanceConsole({
  dashboard,
  systems,
  incidents,
  promptVersions,
  modelObservations,
}: {
  dashboard: AiGovernanceDashboard;
  systems: AiSystemRow[];
  incidents: AiIncidentRow[];
  promptVersions: AiPromptVersionRow[];
  modelObservations: AiModelObservationRow[];
}) {
  const systemById = new Map(systems.map((s) => [s.id, s]));
  const systemByCode = new Map(systems.map((s) => [s.system_code, s]));
  const openIncidents = incidents.filter((i) => OPEN_STATUSES.has(i.status));
  const closedIncidents = incidents.filter((i) => !OPEN_STATUSES.has(i.status));
  const ungoverned = systems.filter((s) => !s.runtime_governed);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">AI governance</h1>
        <p className="max-w-3xl text-charcoal-ink/60">
          Every AI capability the platform runs, what it is allowed to do, what it still owes before
          it can be called validated, and the switch that stops it. Numbers cover the last{" "}
          {dashboard.window_days} days
          {dashboard.scope === "platform" ? " across the platform" : " for your organisation"}.
        </p>
      </div>

      {/* 40.13 — the clinical-governance view */}
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Last 30 days</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="AI interactions" value={dashboard.totals.interactions} />
          <Metric
            label="Escalations"
            value={dashboard.totals.escalations}
            hint="Classified urgent or emergency"
          />
          <Metric
            label="Human overrides"
            value={dashboard.totals.human_overrides}
            hint="A person changed what the AI produced"
          />
          <Metric
            label="High-risk outputs"
            value={dashboard.totals.high_risk_outputs}
            hint="Flagged by hallucination monitoring"
          />
          <Metric
            label="Safety incidents"
            value={dashboard.incidents.total}
            hint={`${dashboard.incidents.open} still open`}
          />
          <Metric
            label="Blocked by a guardrail"
            value={dashboard.totals.blocked_by_guardrail}
            hint="Output suppressed before it reached anyone"
          />
          <Metric
            label="Fallbacks"
            value={dashboard.totals.fallbacks}
            hint="Ran the non-AI path instead"
          />
          <Metric label="Failures" value={dashboard.totals.failures} />
        </div>

        {(dashboard.monitoring.unacknowledged_model_changes > 0 ||
          dashboard.monitoring.drift_breaches > 0 ||
          dashboard.monitoring.material_disparities > 0 ||
          dashboard.monitoring.systems_overdue_review > 0) && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Needs attention</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {dashboard.monitoring.unacknowledged_model_changes > 0 && (
                <li>
                  {dashboard.monitoring.unacknowledged_model_changes} unexpected model
                  {dashboard.monitoring.unacknowledged_model_changes === 1 ? "" : "s"} answered for a
                  registered system
                </li>
              )}
              {dashboard.monitoring.drift_breaches > 0 && (
                <li>{dashboard.monitoring.drift_breaches} drift threshold breaches</li>
              )}
              {dashboard.monitoring.material_disparities > 0 && (
                <li>
                  {dashboard.monitoring.material_disparities} material performance disparities
                  between population groups
                </li>
              )}
              {dashboard.monitoring.systems_overdue_review > 0 && (
                <li>{dashboard.monitoring.systems_overdue_review} systems past their review date</li>
              )}
            </ul>
          </div>
        )}
      </section>

      {/* The honest caveat, first and unmissable. */}
      {ungoverned.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">
            The switch below does not yet stop {ungoverned.length} of these systems.
          </p>
          <p className="mt-1">
            {ungoverned.map((s) => s.system_code).join(", ")}{" "}
            {ungoverned.length === 1 ? "is" : "are"} registered, classified and guardrailed on the
            record, but the running code for{" "}
            {ungoverned.length === 1 ? "it does" : "them does"} not consult this registry yet — so
            switching{" "}
            {ungoverned.length === 1 ? "it" : "them"} off here would not stop{" "}
            {ungoverned.length === 1 ? "it" : "them"} running. Treat the switch as real only for the
            systems marked “kill switch live”.
          </p>
        </div>
      )}

      {/* 40.1/40.2/40.3/40.4/40.17/40.20 — the registry */}
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">AI registry</h2>
        <div className="space-y-3">
          {dashboard.systems.map((entry) => {
            const row = systemByCode.get(entry.system_code);
            const prompts = row
              ? promptVersions.filter((p) => p.ai_system_id === row.id)
              : [];
            const activePrompt = prompts.find((p) => p.is_active);
            const draftPrompt = prompts.find((p) => !p.is_active && !p.approved_at);
            const observations = row
              ? modelObservations.filter((o) => o.ai_system_id === row.id)
              : [];

            return (
              <Card key={entry.system_code}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-charcoal-ink/60">
                          {entry.system_code}
                        </span>
                        {entry.name}
                      </CardTitle>
                      {row && (
                        <p className="mt-1 max-w-2xl text-sm text-charcoal-ink/70">{row.purpose}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={RISK_BADGE_VARIANT[entry.risk_class] ?? "grey"}>
                        {RISK_LABEL[entry.risk_class] ?? entry.risk_class}
                      </Badge>
                      <Badge variant="blue">
                        {AUTONOMY_LABEL[entry.autonomy_level] ?? entry.autonomy_level}
                      </Badge>
                      <Badge variant={entry.is_enabled ? "green" : "grey"}>
                        {entry.is_enabled ? "On" : "Off"}
                      </Badge>
                      <Badge variant={row?.runtime_governed ? "green" : "amber"}>
                        {row?.runtime_governed ? "Kill switch live" : "Kill switch not wired"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <p className="text-charcoal-ink/50">Owner</p>
                      <p className="text-charcoal-ink">
                        {row?.owner_role ?? "—"}
                        {row && !row.owner_profile_id && (
                          <span className="ml-1 text-amber-700">· no named owner yet</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-charcoal-ink/50">Approved version</p>
                      <p className="text-charcoal-ink">
                        {entry.approved_version ?? "None — not yet validated"}
                      </p>
                    </div>
                    <div>
                      <p className="text-charcoal-ink/50">Governed prompt</p>
                      <p className="text-charcoal-ink">
                        {entry.active_prompt_version
                          ? `v${entry.active_prompt_version} active`
                          : "None active — running the in-repo prompt"}
                      </p>
                    </div>
                    <div>
                      <p className="text-charcoal-ink/50">Next review due</p>
                      <p className="text-charcoal-ink">{formatDate(entry.next_review_due)}</p>
                    </div>
                    <div className="sm:col-span-2">
                      <p className="text-charcoal-ink/50">If this is switched off</p>
                      <p className="text-charcoal-ink">{row?.fallback_behaviour ?? "—"}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 text-sm sm:grid-cols-3">
                    <Metric label="Interactions (30d)" value={entry.interactions} />
                    <Metric label="Human overrides" value={entry.human_overrides} />
                    <Metric label="Incidents" value={entry.incidents} />
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-sm text-charcoal-ink/50">
                      Acceptance criteria — purpose, owner, risk, validation, guardrails, monitoring,
                      audit, rollback
                    </p>
                    <AcceptanceChecklist system={entry} />
                    {entry.grandfathered && (
                      <p className="text-xs text-charcoal-ink/60">
                        Registered from production before governance existed. It keeps running, and
                        the gaps above are the work outstanding. Once it is switched off it cannot be
                        switched back on until every criterion is met.
                      </p>
                    )}
                  </div>

                  {observations.length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                      <p className="font-medium">A model we did not approve answered for this system</p>
                      <ul className="mt-1 space-y-0.5">
                        {observations.map((o) => (
                          <li key={o.id}>
                            <span className="font-mono">{o.observed_model_identifier}</span> seen{" "}
                            {o.observation_count.toLocaleString("en-GB")}×, last{" "}
                            {formatDate(o.last_seen_at)} — approved version specifies{" "}
                            <span className="font-mono">
                              {o.expected_model_identifier ?? "nothing yet"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {!row?.disabled_at ? null : (
                    <p className="text-sm text-charcoal-ink/70">
                      Switched off {formatDate(row.disabled_at)}: {row.disabled_reason}
                    </p>
                  )}

                  <div className="flex flex-wrap items-start gap-4">
                    {row && <KillSwitchForm system={row} enabled={entry.is_enabled} />}
                    {draftPrompt && !activePrompt && (
                      <div className="min-w-[20rem] flex-1">
                        <p className="text-sm text-charcoal-ink/70">
                          A draft prompt version (v{draftPrompt.version}) is waiting for a Clinical
                          Director. {draftPrompt.change_summary}
                        </p>
                        <PromptActivationForm promptVersionId={draftPrompt.id} />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* 40.12 — incidents */}
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">
          AI safety incidents
        </h2>
        {openIncidents.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">Nothing open.</p>
        ) : (
          <div className="space-y-3">
            {openIncidents.map((incident) => {
              const system = systemById.get(incident.ai_system_id);
              return (
                <Card key={incident.id}>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-base">
                        {system?.name ?? "Unknown system"} · {incident.category.replace(/_/g, " ")}
                      </CardTitle>
                      <div className="flex items-center gap-1.5">
                        <Badge variant={SEVERITY_VARIANT[incident.severity] ?? "grey"}>
                          {incident.severity}
                        </Badge>
                        <Badge variant="grey">{incident.status}</Badge>
                        <Badge variant="grey">reported by {incident.reporter_kind}</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-charcoal-ink">{incident.description}</p>
                    <p className="text-xs text-charcoal-ink/50">
                      Raised {formatDate(incident.created_at)}
                      {incident.interaction_id ? " · linked to a specific AI interaction" : ""}
                    </p>
                    <IncidentTriageForm incidentId={incident.id} />
                    <IncidentCloseForm incidentId={incident.id} />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {closedIncidents.length > 0 && (
          <details className="rounded-lg border border-charcoal-ink/10 bg-white p-4">
            <summary className="cursor-pointer text-sm font-medium text-charcoal-ink">
              Closed incidents ({closedIncidents.length})
            </summary>
            <ul className="mt-3 space-y-3">
              {closedIncidents.map((incident) => (
                <li key={incident.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={incident.status === "dismissed" ? "grey" : "green"}>
                      {incident.status}
                    </Badge>
                    <span className="text-charcoal-ink">
                      {systemById.get(incident.ai_system_id)?.name ?? "Unknown system"} ·{" "}
                      {incident.category.replace(/_/g, " ")}
                    </span>
                    <span className="text-charcoal-ink/50">{formatDate(incident.resolved_at)}</span>
                  </div>
                  {incident.clinical_review_summary && (
                    <p className="mt-1 text-charcoal-ink/70">{incident.clinical_review_summary}</p>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}

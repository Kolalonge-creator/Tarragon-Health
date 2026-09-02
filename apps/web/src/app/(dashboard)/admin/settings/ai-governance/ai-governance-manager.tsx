"use client";

import { useState } from "react";
import {
  useAiGovernanceDashboard,
  useAiSystemIds,
  useSetAiSystemEnabled,
  type AiGovernanceSystem,
} from "@/lib/queries/ai-governance";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const CRITERIA_LABEL: Record<string, string> = {
  purpose: "Purpose documented",
  owner: "Owner assigned",
  risk_classification: "Risk classified",
  validation: "Validated version approved",
  guardrails: "Active guardrails",
  monitoring: "Monitoring configured",
  audit: "Audit trail wired",
  rollback: "Rollback/fallback documented",
};

const LIFECYCLE_BADGE: Record<string, "grey" | "amber" | "green" | "red" | "blue"> = {
  draft: "grey",
  in_evaluation: "blue",
  approved: "blue",
  live: "green",
  suspended: "red",
  retired: "grey",
};

function SystemRow({ system, systemId }: { system: AiGovernanceSystem; systemId: string | undefined }) {
  const setEnabled = useSetAiSystemEnabled();
  const [showDisableForm, setShowDisableForm] = useState(false);
  const [reason, setReason] = useState("");

  const acceptance = system.acceptance;

  return (
    <li className="space-y-2 border-b border-charcoal-ink/10 py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-charcoal-ink">{system.name}</p>
            <span className="font-mono text-xs text-charcoal-ink/50">{system.system_code}</span>
            <Badge variant={LIFECYCLE_BADGE[system.lifecycle_status] ?? "grey"}>
              {system.lifecycle_status}
            </Badge>
            <Badge variant={system.is_enabled ? "green" : "red"}>
              {system.is_enabled ? "Enabled" : "Disabled"}
            </Badge>
            {system.grandfathered && <Badge variant="amber">Grandfathered</Badge>}
          </div>
          <p className="text-xs text-charcoal-ink/60">
            {system.risk_class ?? "risk unclassified"} risk · {system.autonomy_level ?? "autonomy unset"} ·{" "}
            {system.interactions} interactions ({system.human_overrides} overridden) in this window ·{" "}
            {system.incidents} incident{system.incidents === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {system.is_enabled ? (
            <Button size="sm" variant="outline" onClick={() => setShowDisableForm((v) => !v)}>
              {showDisableForm ? "Cancel" : "Disable"}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!systemId || setEnabled.isPending || !acceptance?.satisfied}
              onClick={() => {
                if (!systemId) return;
                setEnabled.mutate({ id: systemId, enabled: true, reason: "Re-enabled from the admin console" });
              }}
              title={
                !acceptance?.satisfied
                  ? `Outstanding: ${acceptance?.outstanding.map((k) => CRITERIA_LABEL[k] ?? k).join(", ")}`
                  : undefined
              }
            >
              Enable
            </Button>
          )}
        </div>
      </div>

      {showDisableForm && (
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-charcoal-ink/5 p-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs text-charcoal-ink/70" htmlFor={`disable_reason_${system.system_code}`}>
              Reason (required — pages every active Clinical Director and admin immediately)
            </label>
            <Input
              id={`disable_reason_${system.system_code}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Suspected hallucinated dosing suggestions, investigating"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!systemId || !reason.trim() || setEnabled.isPending}
            onClick={() => {
              if (!systemId) return;
              setEnabled.mutate(
                { id: systemId, enabled: false, reason: reason.trim() },
                { onSuccess: () => { setShowDisableForm(false); setReason(""); } }
              );
            }}
          >
            {setEnabled.isPending ? "Disabling…" : "Confirm disable"}
          </Button>
        </div>
      )}

      {acceptance && !acceptance.satisfied && (
        <p className="text-xs text-amber-700">
          Not release-ready: {acceptance.outstanding.map((k) => CRITERIA_LABEL[k] ?? k).join(", ")}
        </p>
      )}
      {setEnabled.isError && (
        <p className="text-xs text-red-600">{(setEnabled.error as Error).message}</p>
      )}
    </li>
  );
}

export function AiGovernanceManager() {
  const { data: dashboard, isLoading, isError } = useAiGovernanceDashboard(30);
  const { data: systemIds } = useAiSystemIds();

  return (
    <div className="space-y-6">
      {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
      {isError && <p className="text-sm text-red-600">Could not load the AI governance dashboard.</p>}

      {dashboard && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Open incidents", dashboard.incidents.open],
              ["Critical open", dashboard.incidents.critical_open],
              ["Patient harm reported", dashboard.incidents.with_patient_harm],
              ["Systems overdue review", dashboard.monitoring.systems_overdue_review],
              ["Drift breaches", dashboard.monitoring.drift_breaches],
              ["Material bias disparities", dashboard.monitoring.material_disparities],
              ["Unacknowledged model changes", dashboard.monitoring.unacknowledged_model_changes],
              ["Human overrides (30d)", dashboard.totals.human_overrides],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl border border-charcoal-ink/10 bg-white p-4">
                <p className="text-xs text-charcoal-ink/60">{label}</p>
                <p className="font-heading text-xl font-semibold text-charcoal-ink">{value}</p>
              </div>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>AI systems</CardTitle>
              <CardDescription>
                Every registered AI system and its kill switch. Disabling requires a reason and
                immediately pages every active Clinical Director and admin — never a silent flip.
                Re-enabling is blocked until every release-readiness criterion below is met; that
                gate is enforced server-side, this UI cannot bypass it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul>
                {dashboard.systems.map((system) => (
                  <SystemRow
                    key={system.system_code}
                    system={system}
                    systemId={systemIds?.get(system.system_code)}
                  />
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

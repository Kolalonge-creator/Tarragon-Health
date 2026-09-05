"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  createProviderQualityPolicyDraftAction,
  signProviderQualityPolicyAction,
  type CreateProviderQualityPolicyDraftState,
  type SignProviderQualityPolicyState,
} from "./actions";

type MetricRow = {
  metric: string;
  domain: string;
  unit: string;
  target: number;
  warning: number;
  direction: "higher_is_better" | "lower_is_better";
  min_denominator: number;
  clinically_governed?: boolean;
  note?: string;
};
type CredentialLadder = {
  warning_days_before_expiry: number;
  grace_days_after_expiry: number;
  restriction_days_after_expiry: number;
  suspension_days_after_expiry: number;
};
type InterventionTrigger = { when: string; suggest: string };
type PolicyConfig = {
  metrics: MetricRow[];
  credential_ladder: CredentialLadder;
  intervention_triggers: InterventionTrigger[];
};

export type ProviderQualityPolicyVersionRow = {
  id: string;
  version: number;
  config: PolicyConfig;
  notes: string | null;
  is_active: boolean;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
};

const DOMAIN_BADGE: Record<string, "blue" | "grey" | "green"> = {
  operational: "blue",
  documentation: "grey",
  patient_experience: "green",
  clinical_quality: "green",
};

function SignButton({ policyId }: { policyId: string }) {
  const [state, action, pending] = useActionState<SignProviderQualityPolicyState, FormData>(
    () => signProviderQualityPolicyAction(policyId),
    undefined
  );
  return (
    <form action={action} className="mt-2 space-y-1">
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Signing…" : "Sign & activate"}
      </Button>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && <p className="text-sm text-brand-green">Signed and now in force.</p>}
    </form>
  );
}

function CreateDraftForm({ nextVersion }: { nextVersion: number }) {
  const [state, action, pending] = useActionState<CreateProviderQualityPolicyDraftState, FormData>(
    createProviderQualityPolicyDraftAction,
    undefined
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Re-attest the latest config: version {nextVersion}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <p className="text-sm text-charcoal-ink/70">
            Creates a draft that duplicates the most recent version&apos;s metric targets, credential
            ladder, and intervention triggers exactly as they stand. To actually change a target or
            timing, that goes through a reviewed, tested migration first; this form only re-attests
            or brings a migration-updated config into force.
          </p>
          <div className="space-y-1">
            <label htmlFor="notes" className="text-sm font-medium text-charcoal-ink">
              Notes (optional)
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              className="w-full rounded-md border border-mist-grey/60 p-2 text-sm"
              placeholder="e.g. Reviewed every metric target and the credential-ladder timings, approved as written."
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Creating…" : "Create draft from latest config"}
          </Button>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && (
            <p className="text-sm text-brand-green">Draft created. Sign it below to bring it into force.</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function MetricsTable({ metrics }: { metrics: MetricRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-mist-grey/40">
      <table className="w-full text-left text-xs">
        <thead className="bg-mist-grey/20 text-charcoal-ink/60">
          <tr>
            <th className="p-2 font-medium">Metric</th>
            <th className="p-2 font-medium">Domain</th>
            <th className="p-2 font-medium">Target</th>
            <th className="p-2 font-medium">Warning</th>
            <th className="p-2 font-medium">Clinical governance</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.metric} className="border-t border-mist-grey/30 align-top">
              <td className="p-2">
                <p className="font-mono text-charcoal-ink/80">{m.metric}</p>
                {m.note && <p className="mt-1 max-w-xs text-charcoal-ink/50">{m.note}</p>}
              </td>
              <td className="p-2">
                <Badge variant={DOMAIN_BADGE[m.domain] ?? "grey"}>{m.domain.replace("_", " ")}</Badge>
              </td>
              <td className="p-2 text-charcoal-ink/70">
                {m.target}
                {m.unit === "percent" ? "%" : ` ${m.unit}`} ({m.direction === "higher_is_better" ? "↑" : "↓"} is better)
              </td>
              <td className="p-2 text-charcoal-ink/70">
                {m.warning}
                {m.unit === "percent" ? "%" : ` ${m.unit}`}
              </td>
              <td className="p-2">
                {m.domain !== "clinical_quality" ? (
                  <span className="text-charcoal-ink/40">— management target</span>
                ) : m.clinically_governed === false ? (
                  <Badge variant="amber">Not yet validated</Badge>
                ) : (
                  <Badge variant="green">Clinically governed</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CredentialLadderSummary({ ladder }: { ladder: CredentialLadder }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Credential expiry ladder</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 text-sm text-charcoal-ink/70 sm:grid-cols-4">
        <span>Warning: {ladder.warning_days_before_expiry}d before expiry</span>
        <span>Grace: {ladder.grace_days_after_expiry}d after</span>
        <span>Restricted: {ladder.restriction_days_after_expiry}d after</span>
        <span>Suspended: {ladder.suspension_days_after_expiry}d after</span>
      </CardContent>
    </Card>
  );
}

function InterventionTriggersList({ triggers }: { triggers: InterventionTrigger[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Intervention triggers</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm text-charcoal-ink/70">
          {triggers.map((t) => (
            <li key={t.when}>
              <span className="font-mono text-xs">{t.when}</span> → suggests <strong>{t.suggest}</strong>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function ProviderQualityPolicyManager({
  versions,
  activeVersion,
  nextVersion,
}: {
  versions: ProviderQualityPolicyVersionRow[];
  activeVersion: ProviderQualityPolicyVersionRow | null;
  nextVersion: number;
}) {
  return (
    <div className="space-y-6">
      {activeVersion ? (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <div className="flex items-center gap-2">
              <Badge variant={activeVersion.approved_at ? "green" : "amber"}>
                {activeVersion.approved_at ? "Signed" : "Live, unsigned"}, version {activeVersion.version}
              </Badge>
            </div>
            <p className="text-sm text-charcoal-ink/70">{activeVersion.notes}</p>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-charcoal-ink/60">No provider_quality_policy version found.</p>
      )}

      {activeVersion && (
        <div className="space-y-4">
          <MetricsTable metrics={activeVersion.config.metrics} />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <CredentialLadderSummary ladder={activeVersion.config.credential_ladder} />
            <InterventionTriggersList triggers={activeVersion.config.intervention_triggers} />
          </div>
        </div>
      )}

      <CreateDraftForm nextVersion={nextVersion} />

      {versions.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Version history</h2>
          {versions.map((v) => (
            <Card key={v.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  Version {v.version}
                  {v.is_active ? <Badge variant="green">Active</Badge> : <Badge variant="grey">Superseded</Badge>}
                  {v.approved_at ? <Badge variant="green">Signed</Badge> : <Badge variant="amber">Unsigned</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {v.notes && <p className="text-sm text-charcoal-ink/70">{v.notes}</p>}
                <p className="text-xs text-charcoal-ink/50">
                  Drafted {new Date(v.created_at).toLocaleString("en-GB")} ·{" "}
                  {v.config.metrics?.length ?? 0} metrics
                </p>
                {!v.approved_at && (
                  <>
                    <p className="text-xs text-charcoal-ink/60">
                      Signing requires an active Clinical Director account and brings this version
                      into force, retiring whichever version is currently active.
                    </p>
                    <SignButton policyId={v.id} />
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

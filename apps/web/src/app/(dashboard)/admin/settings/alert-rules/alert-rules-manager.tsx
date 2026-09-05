"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  createAlertRulesDraftAction,
  signAlertRulesAction,
  type CreateAlertRulesDraftState,
  type SignAlertRulesState,
} from "./actions";

type AlertTypeRow = {
  category: string;
  type_code: string;
  owner_tier: string;
  backup_tier: string | null;
  senior_tier: string | null;
  channel_sequence: string[];
  default_severity: number;
  severity_meaning: string;
  ack_timeout_minutes: number;
  suppress_window_minutes: number | null;
  auto_suppress_duplicates: boolean;
  evidence_basis: string | null;
};

export type AlertRulesVersionRow = {
  id: string;
  version: number;
  config: AlertTypeRow[];
  notes: string | null;
  is_active: boolean;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
};

const SEVERITY_LABEL: Record<number, { label: string; variant: "grey" | "blue" | "amber" | "red" }> = {
  1: { label: "Routine", variant: "grey" },
  2: { label: "Doctor review", variant: "blue" },
  3: { label: "Urgent", variant: "amber" },
  4: { label: "Emergency", variant: "red" },
};

function SignButton({ versionId }: { versionId: string }) {
  const [state, action, pending] = useActionState<SignAlertRulesState, FormData>(
    () => signAlertRulesAction(versionId),
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
  const [state, action, pending] = useActionState<CreateAlertRulesDraftState, FormData>(
    createAlertRulesDraftAction,
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
            Creates a draft that duplicates the most recent version&apos;s alert taxonomy exactly as
            it stands. To actually change a severity, owner tier, or channel, that goes through a
            reviewed, tested migration first; this form only re-attests or brings a
            migration-updated config into force.
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
              placeholder="e.g. Reviewed every alert type's owner tier and ack timeout, approved as written."
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

function AlertTypeTable({ config }: { config: AlertTypeRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-mist-grey/40">
      <table className="w-full text-left text-xs">
        <thead className="bg-mist-grey/20 text-charcoal-ink/60">
          <tr>
            <th className="p-2 font-medium">Type</th>
            <th className="p-2 font-medium">Category</th>
            <th className="p-2 font-medium">Severity</th>
            <th className="p-2 font-medium">Owner tier</th>
            <th className="p-2 font-medium">Ack timeout</th>
          </tr>
        </thead>
        <tbody>
          {config.map((entry) => {
            const severity = SEVERITY_LABEL[entry.default_severity] ?? { label: `Level ${entry.default_severity}`, variant: "grey" as const };
            return (
              <tr key={entry.type_code} className="border-t border-mist-grey/30">
                <td className="p-2 font-mono">{entry.type_code}</td>
                <td className="p-2 text-charcoal-ink/70">{entry.category}</td>
                <td className="p-2">
                  <Badge variant={severity.variant}>{severity.label}</Badge>
                </td>
                <td className="p-2 text-charcoal-ink/70">{entry.owner_tier}</td>
                <td className="p-2 text-charcoal-ink/70">{entry.ack_timeout_minutes} min</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function AlertRulesManager({
  versions,
  activeVersion,
  nextVersion,
}: {
  versions: AlertRulesVersionRow[];
  activeVersion: AlertRulesVersionRow | null;
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
            <p className="text-sm text-charcoal-ink/70">
              This taxonomy is already driving every clinician alert on the platform today, signed or
              not — {activeVersion.config.length} alert types across abnormal results, vitals red
              flags, symptom escalation, medication safety, and care-management. {activeVersion.notes}
            </p>
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-charcoal-ink/60">No alert_rules version found.</p>
      )}

      {activeVersion && <AlertTypeTable config={activeVersion.config} />}

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
                  {Array.isArray(v.config) ? v.config.length : 0} alert type
                  {Array.isArray(v.config) && v.config.length === 1 ? "" : "s"}
                </p>
                {!v.approved_at && (
                  <>
                    <p className="text-xs text-charcoal-ink/60">
                      Signing requires an active Clinical Director account and brings this version
                      into force, retiring whichever version is currently active.
                    </p>
                    <SignButton versionId={v.id} />
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

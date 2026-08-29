"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DOCTOR_TIER_LABEL } from "@/lib/clinical/doctor-tier";
import {
  createAlertRulesDraftAction,
  signAlertRulesAction,
  type CreateAlertRulesDraftState,
  type SignAlertRulesState,
} from "./actions";

type AlertRuleEntry = {
  category: string;
  type_code: string;
  default_severity: number;
  severity_meaning: string;
  evidence_basis: string;
  owner_tier: string;
  backup_tier?: string | null;
  senior_tier?: string | null;
  ack_timeout_minutes: number;
  channel_sequence?: string[];
  auto_suppress_duplicates?: boolean;
  suppress_window_minutes?: number | null;
  effective_date?: string | null;
  review_date?: string | null;
};

export type AlertRulesVersionRow = {
  id: string;
  version: number;
  config: AlertRuleEntry[];
  notes: string | null;
  is_active: boolean;
  approved_at: string | null;
  created_at: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  clinical: "Clinical",
  care_management: "Care management",
  medication: "Medication",
  operational: "Operational",
};

function tierLabel(tier: string | null | undefined): string {
  if (!tier) return "—";
  return DOCTOR_TIER_LABEL[tier as keyof typeof DOCTOR_TIER_LABEL] ?? tier;
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} min`;
}

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
        <CardTitle className="text-base">Re-attest the current config: version {nextVersion}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <p className="text-sm text-charcoal-ink/70">
            Creates a draft that duplicates the active configuration below exactly as it stands.
            Sign it to put a fresh reviewed-and-approved record on file. To actually change who owns
            an alert type, its timeout, or its channel sequence, that goes through a reviewed, tested
            migration first; this form only re-attests or brings a migration-updated config into
            force.
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
              placeholder="e.g. Reviewed ownership and ack-timeout for every alert type."
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Creating…" : "Create draft from current config"}
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

function ConfigTable({ config }: { config: AlertRuleEntry[] }) {
  if (!Array.isArray(config) || config.length === 0) {
    return <p className="text-sm text-charcoal-ink/60">No entries in this config version.</p>;
  }

  const sorted = [...config].sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.type_code.localeCompare(b.type_code);
  });

  return (
    <div className="overflow-auto rounded-md border border-mist-grey/40">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-mist-grey/40 text-left text-charcoal-ink/70">
          <tr>
            <th className="p-2">Alert type</th>
            <th className="p-2">Owner</th>
            <th className="p-2">Backup</th>
            <th className="p-2">Senior</th>
            <th className="p-2">Response time</th>
            <th className="p-2">Channels</th>
            <th className="p-2">Evidence basis</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry) => (
            <tr
              key={`${entry.category}-${entry.type_code}`}
              className="border-t border-mist-grey/30 align-top"
            >
              <td className="p-2">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-xs">{entry.type_code}</span>
                  <Badge variant="grey">{CATEGORY_LABEL[entry.category] ?? entry.category}</Badge>
                </div>
              </td>
              <td className="p-2">{tierLabel(entry.owner_tier)}</td>
              <td className="p-2 text-charcoal-ink/70">{tierLabel(entry.backup_tier)}</td>
              <td className="p-2 text-charcoal-ink/70">{tierLabel(entry.senior_tier)}</td>
              <td className="p-2">{formatMinutes(entry.ack_timeout_minutes)}</td>
              <td className="p-2 text-xs text-charcoal-ink/60">
                {Array.isArray(entry.channel_sequence) ? entry.channel_sequence.join(" → ") : "—"}
              </td>
              <td className="p-2 text-xs text-charcoal-ink/60">{entry.evidence_basis}</td>
            </tr>
          ))}
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
              <Badge variant={activeVersion.approved_at ? "green" : "grey"}>
                {activeVersion.approved_at ? "Signed" : "Unsigned"}, version {activeVersion.version}
              </Badge>
            </div>
            <p className="text-sm text-charcoal-ink/70">
              {activeVersion.approved_at
                ? `In force since ${new Date(activeVersion.approved_at).toLocaleString("en-GB")}.`
                : "This version is live and driving every alert's ownership, routing, and response-time policy today. That isn't gated on a signature. A Director's signature is a formal record of review, not a switch."}{" "}
              {activeVersion.notes}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Badge variant="grey">No active configuration found</Badge>
          </CardContent>
        </Card>
      )}

      {activeVersion && <ConfigTable config={activeVersion.config} />}

      <CreateDraftForm nextVersion={nextVersion} />

      {versions.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Version history</h2>
          {versions.map((v) => (
            <Card key={v.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  Version {v.version}
                  {v.is_active ? (
                    <Badge variant="green">Active</Badge>
                  ) : (
                    <Badge variant="grey">Draft, not in force</Badge>
                  )}
                  {v.approved_at && <Badge variant="green">Signed</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {v.notes && <p className="text-sm text-charcoal-ink/70">{v.notes}</p>}
                <p className="text-xs text-charcoal-ink/50">
                  Drafted {new Date(v.created_at).toLocaleString("en-GB")} ·{" "}
                  {Array.isArray(v.config) ? v.config.length : 0} entries
                </p>
                {!v.is_active && (
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

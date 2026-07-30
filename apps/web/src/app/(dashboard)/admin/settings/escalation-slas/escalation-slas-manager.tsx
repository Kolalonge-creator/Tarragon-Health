"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  createEscalationSlaDraftAction,
  signEscalationSlasAction,
  type CreateEscalationSlaDraftState,
  type SignEscalationSlasState,
} from "./actions";

type EscalationSlaEntry = {
  pathway: string;
  tier: string;
  sla_minutes: number;
  channel_sequence?: string[];
  source_function?: string | null;
  note?: string;
};

export type EscalationSlaVersionRow = {
  id: string;
  version: number;
  config: EscalationSlaEntry[];
  notes: string | null;
  is_active: boolean;
  approved_at: string | null;
  created_at: string;
};

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${minutes} min (${days} day${days === 1 ? "" : "s"})`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${minutes} min (${hours} hour${hours === 1 ? "" : "s"})`;
  }
  return `${minutes} min`;
}

const TIER_LABEL: Record<string, string> = {
  routine: "Routine",
  clinician_review: "Clinician review",
  urgent_escalation: "Urgent escalation",
  emergency: "Emergency",
};

function SignButton({ versionId }: { versionId: string }) {
  const [state, action, pending] = useActionState<SignEscalationSlasState, FormData>(
    () => signEscalationSlasAction(versionId),
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
  const [state, action, pending] = useActionState<CreateEscalationSlaDraftState, FormData>(
    createEscalationSlaDraftAction,
    undefined
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Re-attest the current config — version {nextVersion}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <p className="text-sm text-charcoal-ink/70">
            Creates a draft that duplicates the active configuration below exactly as it stands.
            Sign it to put a fresh reviewed-and-approved record on file. To actually change an SLA
            number, that goes through a reviewed, tested migration first — this form only re-attests
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
              placeholder="e.g. Reviewed and reconciled the urgent_escalation divergence across pathways."
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Creating…" : "Create draft from current config"}
          </Button>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && (
            <p className="text-sm text-brand-green">Draft created — sign it below to bring it into force.</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function ConfigTable({ config }: { config: EscalationSlaEntry[] }) {
  if (!Array.isArray(config) || config.length === 0) {
    return <p className="text-sm text-charcoal-ink/60">No entries in this config version.</p>;
  }

  const sorted = [...config].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier.localeCompare(b.tier);
    return a.sla_minutes - b.sla_minutes;
  });

  // Flag any tier that carries more than one distinct SLA duration across
  // pathways — surfaces the exact live inconsistency this port was built to
  // make visible, rather than burying it in prose alone.
  const distinctByTier = new Map<string, Set<number>>();
  for (const entry of sorted) {
    const set = distinctByTier.get(entry.tier) ?? new Set<number>();
    set.add(entry.sla_minutes);
    distinctByTier.set(entry.tier, set);
  }

  return (
    <div className="overflow-auto rounded-md border border-mist-grey/40">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-mist-grey/40 text-left text-charcoal-ink/70">
          <tr>
            <th className="p-2">Tier</th>
            <th className="p-2">Pathway</th>
            <th className="p-2">SLA</th>
            <th className="p-2">Channels</th>
            <th className="p-2">Note</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry, i) => {
            const inconsistent = (distinctByTier.get(entry.tier)?.size ?? 0) > 1;
            return (
              <tr key={`${entry.pathway}-${entry.tier}-${i}`} className="border-t border-mist-grey/30 align-top">
                <td className="p-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{TIER_LABEL[entry.tier] ?? entry.tier}</span>
                    {inconsistent && (
                      <Badge variant="amber" title="This tier carries more than one distinct SLA across pathways">
                        Diverges
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="p-2 font-mono text-xs">{entry.pathway}</td>
                <td className="p-2">{formatMinutes(entry.sla_minutes)}</td>
                <td className="p-2 text-xs text-charcoal-ink/60">
                  {Array.isArray(entry.channel_sequence) ? entry.channel_sequence.join(" → ") : "—"}
                </td>
                <td className="p-2 text-xs text-charcoal-ink/60">{entry.note ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function EscalationSlasManager({
  versions,
  activeVersion,
  nextVersion,
}: {
  versions: EscalationSlaVersionRow[];
  activeVersion: EscalationSlaVersionRow | null;
  nextVersion: number;
}) {
  return (
    <div className="space-y-6">
      {activeVersion ? (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <div className="flex items-center gap-2">
              <Badge variant={activeVersion.approved_at ? "green" : "grey"}>
                {activeVersion.approved_at ? "Signed" : "Unsigned"} — version {activeVersion.version}
              </Badge>
            </div>
            <p className="text-sm text-charcoal-ink/70">
              {activeVersion.approved_at
                ? `In force since ${new Date(activeVersion.approved_at).toLocaleString("en-GB")}.`
                : "This version is live and driving every clinician_alert's sla_due_at today — that isn't gated on a signature. A Director's signature is a formal record of review, not a switch."}{" "}
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
                    <Badge variant="grey">Draft — not in force</Badge>
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

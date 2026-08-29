"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  createResultReleasePolicyDraftAction,
  signResultReleasePoliciesAction,
  type CreateResultReleasePolicyDraftState,
  type SignResultReleasePoliciesState,
} from "./actions";

type ReleasePolicyEntry = {
  screen_type_code: string;
  release_mode: "immediate" | "after_review" | "restricted";
  reason?: string;
};

export type ResultReleasePolicyVersionRow = {
  id: string;
  version: number;
  config: ReleasePolicyEntry[];
  notes: string | null;
  is_active: boolean;
  approved_at: string | null;
  created_at: string;
};

const MODE_BADGE: Record<ReleasePolicyEntry["release_mode"], { label: string; variant: "green" | "amber" | "red" }> = {
  immediate: { label: "Immediate", variant: "green" },
  after_review: { label: "After review", variant: "amber" },
  restricted: { label: "Restricted (doctor-delivered)", variant: "red" },
};

function SignButton({ versionId }: { versionId: string }) {
  const [state, action, pending] = useActionState<SignResultReleasePoliciesState, FormData>(
    () => signResultReleasePoliciesAction(versionId),
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
  const [state, action, pending] = useActionState<CreateResultReleasePolicyDraftState, FormData>(
    createResultReleasePolicyDraftAction,
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
            Sign it to put a fresh reviewed-and-approved record on file. To actually change which
            screen types are restricted, that goes through a reviewed, tested migration first; this
            form only re-attests or brings a migration-updated config into force.
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
              placeholder="e.g. Reviewed the restricted-type list against the current AHC pathway."
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

function ConfigTable({ config }: { config: ReleasePolicyEntry[] }) {
  if (!Array.isArray(config) || config.length === 0) {
    return <p className="text-sm text-charcoal-ink/60">No entries — every result type releases immediately.</p>;
  }

  const sorted = [...config].sort((a, b) => a.screen_type_code.localeCompare(b.screen_type_code));

  return (
    <div className="overflow-auto rounded-md border border-mist-grey/40">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-mist-grey/40 text-left text-charcoal-ink/70">
          <tr>
            <th className="p-2">Screen type</th>
            <th className="p-2">Release mode</th>
            <th className="p-2">Reason</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry) => {
            const badge = MODE_BADGE[entry.release_mode];
            return (
              <tr key={entry.screen_type_code} className="border-t border-mist-grey/30 align-top">
                <td className="p-2 font-mono text-xs">{entry.screen_type_code}</td>
                <td className="p-2">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </td>
                <td className="p-2 text-xs text-charcoal-ink/60">{entry.reason ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ResultReleasePoliciesManager({
  versions,
  activeVersion,
  nextVersion,
}: {
  versions: ResultReleasePolicyVersionRow[];
  activeVersion: ResultReleasePolicyVersionRow | null;
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
                : "This version is live and driving every patient's read access to their own results today. That isn't gated on a signature. A Director's signature is a formal record of review, not a switch."}{" "}
              {activeVersion.notes}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Badge variant="grey">No active configuration found — every result releases immediately</Badge>
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

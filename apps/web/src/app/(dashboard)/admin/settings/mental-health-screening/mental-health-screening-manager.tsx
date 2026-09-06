"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VersionHistoryList } from "@/components/shell/version-history-list";
import {
  createScreeningCadenceDraftAction,
  signScreeningCadenceAction,
  type CreateScreeningCadenceDraftState,
  type SignScreeningCadenceState,
} from "./actions";

type CadenceRow = {
  instrument: string;
  followup_interval_months: number;
  standard_interval_months: number;
};

export type ScreeningCadenceVersionRow = {
  id: string;
  version: number;
  config: CadenceRow[];
  notes: string | null;
  is_active: boolean;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
};

const INSTRUMENT_LABEL: Record<string, string> = {
  phq9: "PHQ-9 (depression)",
  gad7: "GAD-7 (anxiety)",
  auditc: "AUDIT-C (alcohol use)",
};

function SignButton({ versionId }: { versionId: string }) {
  const [state, action, pending] = useActionState<SignScreeningCadenceState, FormData>(
    () => signScreeningCadenceAction(versionId),
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
  const [state, action, pending] = useActionState<CreateScreeningCadenceDraftState, FormData>(
    createScreeningCadenceDraftAction,
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
            Creates a draft that duplicates the most recent version&apos;s cadences exactly as they
            stand. To actually change an interval, that goes through a reviewed, tested migration
            first; this form only re-attests or brings a migration-updated config into force.
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
              placeholder="e.g. Reviewed all three instruments' cadences, approved as written."
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

function CadenceTable({ config }: { config: CadenceRow[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-mist-grey/40">
      <table className="w-full text-left text-xs">
        <thead className="bg-mist-grey/20 text-charcoal-ink/60">
          <tr>
            <th className="p-2 font-medium">Instrument</th>
            <th className="p-2 font-medium">Standard interval</th>
            <th className="p-2 font-medium">Follow-up interval after a concern band</th>
          </tr>
        </thead>
        <tbody>
          {config.map((entry) => (
            <tr key={entry.instrument} className="border-t border-mist-grey/30">
              <td className="p-2 text-charcoal-ink/80">{INSTRUMENT_LABEL[entry.instrument] ?? entry.instrument}</td>
              <td className="p-2 text-charcoal-ink/70">{entry.standard_interval_months} months</td>
              <td className="p-2 text-charcoal-ink/70">{entry.followup_interval_months} months</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MentalHealthScreeningManager({
  versions,
  activeVersion,
  nextVersion,
}: {
  versions: ScreeningCadenceVersionRow[];
  activeVersion: ScreeningCadenceVersionRow | null;
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
        <p className="text-sm text-charcoal-ink/60">No mental_health_screening_cadences version found.</p>
      )}

      {activeVersion && <CadenceTable config={activeVersion.config} />}

      <CreateDraftForm nextVersion={nextVersion} />

      {versions.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Version history</h2>
          <VersionHistoryList>
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
                    {Array.isArray(v.config) ? v.config.length : 0} instrument
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
          </VersionHistoryList>
        </div>
      )}
    </div>
  );
}

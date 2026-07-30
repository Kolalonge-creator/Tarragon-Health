"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  createVaccinationScheduleDraftAction,
  signVaccinationScheduleAction,
  type CreateSignoffDraftState,
  type SignVaccinationScheduleState,
} from "./actions";

export type VaccinationCatalogRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  recommended_age: unknown;
  is_active: boolean;
};

export type VaccinationScheduleSignoffRow = {
  id: string;
  version: number;
  notes: string | null;
  source_url: string | null;
  is_active: boolean;
  approved_at: string | null;
  created_at: string;
  catalog_snapshot: unknown;
};

function SignButton({ signoffId }: { signoffId: string }) {
  const [state, action, pending] = useActionState<SignVaccinationScheduleState, FormData>(
    () => signVaccinationScheduleAction(signoffId),
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
  const [state, action, pending] = useActionState<CreateSignoffDraftState, FormData>(
    createVaccinationScheduleDraftAction,
    undefined
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Review the current schedule: version {nextVersion}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <p className="text-sm text-charcoal-ink/70">
            Creating a draft snapshots every active vaccination_catalog entry below exactly as it
            stands right now. Once you sign it, that snapshot is the permanent record of what was
            reviewed and approved. A later catalog change needs a fresh draft and a fresh signature.
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
              placeholder="e.g. Reviewed NPHCDA + WHO dosing against the 2026-07-24 tetanus/shingles accuracy pass."
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="source_url" className="text-sm font-medium text-charcoal-ink">
              Source reference (optional)
            </label>
            <input
              id="source_url"
              name="source_url"
              type="url"
              className="w-full rounded-md border border-mist-grey/60 p-2 text-sm"
              placeholder="https://…"
            />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Creating…" : "Create draft from current schedule"}
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

function CatalogList({ catalog }: { catalog: VaccinationCatalogRow[] }) {
  if (catalog.length === 0) {
    return <p className="text-sm text-charcoal-ink/60">No active vaccination_catalog entries.</p>;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Current schedule: {catalog.length} active entries</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="max-h-96 overflow-auto rounded-md border border-mist-grey/40">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-mist-grey/40 text-left text-charcoal-ink/70">
              <tr>
                <th className="p-2">Code</th>
                <th className="p-2">Name</th>
                <th className="p-2">Description</th>
                <th className="p-2">Recommended age</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map((item) => (
                <tr key={item.id} className="border-t border-mist-grey/30 align-top">
                  <td className="p-2 font-mono text-xs">{item.code}</td>
                  <td className="p-2">{item.name}</td>
                  <td className="p-2 text-charcoal-ink/70">{item.description ?? "—"}</td>
                  <td className="p-2 font-mono text-xs text-charcoal-ink/70">
                    {JSON.stringify(item.recommended_age)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export function VaccinationScheduleManager({
  catalog,
  signoffs,
  activeSignoff,
  nextVersion,
}: {
  catalog: VaccinationCatalogRow[];
  signoffs: VaccinationScheduleSignoffRow[];
  activeSignoff: VaccinationScheduleSignoffRow | null;
  nextVersion: number;
}) {
  return (
    <div className="space-y-6">
      {activeSignoff ? (
        <Card>
          <CardContent className="pt-6">
            <Badge variant="green">Signed, version {activeSignoff.version}</Badge>
            <p className="mt-2 text-sm text-charcoal-ink/70">
              In force since{" "}
              {activeSignoff.approved_at
                ? new Date(activeSignoff.approved_at).toLocaleString("en-GB")
                : "—"}
              . {activeSignoff.notes}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Badge variant="grey">No signed version on file</Badge>
            <p className="mt-2 text-sm text-charcoal-ink/70">
              The schedule below is live and driving reminders today regardless. This record is a
              Clinical Director&apos;s confirmation that it has been reviewed, not a gate on whether
              it works.
            </p>
          </CardContent>
        </Card>
      )}

      <CatalogList catalog={catalog} />
      <CreateDraftForm nextVersion={nextVersion} />

      {signoffs.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Sign-off history</h2>
          {signoffs.map((s) => (
            <Card key={s.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  Version {s.version}
                  {s.is_active ? (
                    <Badge variant="green">Active, signed</Badge>
                  ) : (
                    <Badge variant="grey">Draft, not in force</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {s.notes && <p className="text-sm text-charcoal-ink/70">{s.notes}</p>}
                {s.source_url && (
                  <p className="text-xs text-charcoal-ink/50">
                    Source:{" "}
                    <a href={s.source_url} target="_blank" rel="noreferrer" className="underline">
                      {s.source_url}
                    </a>
                  </p>
                )}
                <p className="text-xs text-charcoal-ink/50">
                  Drafted {new Date(s.created_at).toLocaleString("en-GB")} · snapshot of{" "}
                  {Array.isArray(s.catalog_snapshot) ? s.catalog_snapshot.length : 0} catalog entries
                </p>
                {!s.is_active && (
                  <>
                    <p className="text-xs text-charcoal-ink/60">
                      Signing requires an active Clinical Director account and brings this snapshot
                      into force as the reviewed schedule.
                    </p>
                    <SignButton signoffId={s.id} />
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

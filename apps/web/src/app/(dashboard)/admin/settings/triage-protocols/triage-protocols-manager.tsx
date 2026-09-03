"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  createTriageProtocolDraftAction,
  signTriageProtocolsAction,
  type CreateTriageProtocolDraftState,
  type SignTriageProtocolsState,
} from "./actions";

type RedFlagRuleRow = { key: string; label: string; category: string };
type PathwayRow = {
  key: string;
  label: string;
  redFlagScreen: RedFlagRuleRow[];
  nodes: Record<string, unknown>;
};
type TriageProtocolConfigRow = { version: number; pathways: PathwayRow[] };

export type TriageProtocolVersionRow = {
  id: string;
  version: number;
  config: TriageProtocolConfigRow;
  notes: string | null;
  is_active: boolean;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
};

const CATEGORY_BADGE: Record<string, "red" | "amber" | "blue" | "green" | "grey"> = {
  emergency: "red",
  urgent: "amber",
  routine: "blue",
  self_management: "green",
};

function SignButton({ versionId }: { versionId: string }) {
  const [state, action, pending] = useActionState<SignTriageProtocolsState, FormData>(
    () => signTriageProtocolsAction(versionId),
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
  const [state, action, pending] = useActionState<CreateTriageProtocolDraftState, FormData>(
    createTriageProtocolDraftAction,
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
            Creates a draft that duplicates the most recent version&apos;s pathways exactly as they
            stand. To actually change a red-flag threshold or a question, that goes through a
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
              placeholder="e.g. Reviewed the headache/chest pain/breathlessness pathways, approved as written."
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

function PathwaySummary({ pathway }: { pathway: PathwayRow }) {
  return (
    <div className="rounded-md border border-mist-grey/40 p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-charcoal-ink">{pathway.label}</span>
        <span className="text-xs text-charcoal-ink/50 font-mono">{pathway.key}</span>
      </div>
      <p className="mt-1 text-xs text-charcoal-ink/60">
        {pathway.redFlagScreen.length} red-flag rule{pathway.redFlagScreen.length === 1 ? "" : "s"} ·{" "}
        {Object.keys(pathway.nodes).length} question-tree node{Object.keys(pathway.nodes).length === 1 ? "" : "s"}
      </p>
      <ul className="mt-2 space-y-1">
        {pathway.redFlagScreen.map((rule) => (
          <li key={rule.key} className="flex items-center gap-2 text-xs">
            <Badge variant={CATEGORY_BADGE[rule.category] ?? "grey"}>{rule.category}</Badge>
            <span className="text-charcoal-ink/70">{rule.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TriageProtocolsManager({
  versions,
  activeVersion,
  nextVersion,
}: {
  versions: TriageProtocolVersionRow[];
  activeVersion: TriageProtocolVersionRow | null;
  nextVersion: number;
}) {
  return (
    <div className="space-y-6">
      {activeVersion ? (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <div className="flex items-center gap-2">
              <Badge variant="green">Signed, version {activeVersion.version}</Badge>
            </div>
            <p className="text-sm text-charcoal-ink/70">
              In force since{" "}
              {activeVersion.approved_at ? new Date(activeVersion.approved_at).toLocaleString("en-GB") : "—"}. The
              patient-facing symptom checker is live. {activeVersion.notes}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <Badge variant="amber">No signed configuration: symptom checker is OFF for patients</Badge>
            <p className="text-sm text-charcoal-ink/70">
              The Symptom Assessment &amp; Triage Engine (platform brief §37) stays hidden from patients
              until a Clinical Director reviews and signs a version below. This is deliberate. See
              docs/SYMPTOM_TRIAGE_ENGINE_SPEC.md.
            </p>
          </CardContent>
        </Card>
      )}

      {activeVersion && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {activeVersion.config.pathways.map((p) => (
            <PathwaySummary key={p.key} pathway={p} />
          ))}
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
                  {v.is_active ? <Badge variant="green">Active</Badge> : <Badge variant="grey">Draft, not in force</Badge>}
                  {v.approved_at && <Badge variant="green">Signed</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {v.notes && <p className="text-sm text-charcoal-ink/70">{v.notes}</p>}
                <p className="text-xs text-charcoal-ink/50">
                  Drafted {new Date(v.created_at).toLocaleString("en-GB")} ·{" "}
                  {Array.isArray(v.config?.pathways) ? v.config.pathways.length : 0} pathway
                  {Array.isArray(v.config?.pathways) && v.config.pathways.length === 1 ? "" : "s"}
                </p>
                {!v.is_active && (
                  <>
                    <p className="text-xs text-charcoal-ink/60">
                      Signing requires an active Clinical Director account and brings this version into
                      force, retiring whichever version is currently active, and turns the patient-facing
                      symptom checker on if nothing was signed before.
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

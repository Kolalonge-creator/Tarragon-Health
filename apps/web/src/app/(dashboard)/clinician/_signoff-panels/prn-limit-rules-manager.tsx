"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VersionHistoryList } from "@/components/shell/version-history-list";
import { isSupersededVersion } from "@/lib/clinical/refuse-superseded-draft";
import {
  createPrnLimitRulesDraftAction,
  signPrnLimitRulesAction,
  type CreatePrnLimitRulesDraftState,
  type SignPrnLimitRulesState,
} from "../prn-limit-rules/actions";

export type PrnLimitRulesConfig = {
  minGapMinutesBounds: [number, number];
  dailyMaxBounds: [number, number];
  repeatSignal: { flaggedDoses: number; windowDays: number };
};

export type PrnLimitRulesVersionRow = {
  id: string;
  version: number;
  config: PrnLimitRulesConfig;
  notes: string | null;
  is_active: boolean;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
};

function SignButton({ rulesId }: { rulesId: string }) {
  const [state, action, pending] = useActionState<SignPrnLimitRulesState, FormData>(
    () => signPrnLimitRulesAction(rulesId),
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
  const [state, action, pending] = useActionState<CreatePrnLimitRulesDraftState, FormData>(
    createPrnLimitRulesDraftAction,
    undefined
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Re-attest the latest rule: version {nextVersion}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <p className="text-sm text-charcoal-ink/70">
            Creates a draft that repeats the latest bounds and repeat rule exactly. To change a bound, change the
            proposed configuration and add a version through a reviewed migration first.
          </p>
          <textarea
            name="notes"
            rows={2}
            aria-label="Notes (optional)"
            className="w-full rounded-md border border-mist-grey/60 p-2 text-sm"
            placeholder="Optional note for the record."
          />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Creating…" : "Create draft from latest rule"}
          </Button>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Draft created. Sign it below to bring it into force.</p>}
        </form>
      </CardContent>
    </Card>
  );
}

function RuleSummary({ config }: { config: PrnLimitRulesConfig }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What signing this allows</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-charcoal-ink/80">
        <p>
          A clinician with prescribing authority, tied to the patient, may set for one as-needed medicine a shortest
          gap between doses ({config.minGapMinutesBounds[0]} to {config.minGapMinutesBounds[1]} minutes) and/or a most
          doses in a Lagos day ({config.dailyMaxBounds[0]} to {config.dailyMaxBounds[1]}). There are no defaults: a
          medicine with no limit set is never checked.
        </p>
        <p>
          A dose logged outside a limit is <strong>still logged</strong>. The patient is shown: &ldquo;This is sooner than
          your care plan says. Check with your care team before taking another&rdquo;. The app never suggests a double dose.
        </p>
        <p>
          When {config.repeatSignal.flaggedDoses} doses of one medicine are flagged within {config.repeatSignal.windowDays}{" "}
          days, the care team gets one signal in the rules queue (a review prompt, not an alarm).
        </p>
        <p className="text-xs text-charcoal-ink/60">
          The check also stays behind a separate go-live switch (&ldquo;As-needed medicine limits&rdquo;), which is off. Signing
          this rule does not turn it on.
        </p>
      </CardContent>
    </Card>
  );
}

export function PrnLimitRulesManager({
  versions,
  activeVersion,
  nextVersion,
}: {
  versions: PrnLimitRulesVersionRow[];
  activeVersion: PrnLimitRulesVersionRow | null;
  nextVersion: number;
}) {
  const shown = activeVersion ?? versions.find((v) => !v.approved_at) ?? versions[0] ?? null;
  return (
    <div className="space-y-6">
      {activeVersion ? (
        <Badge variant="green">Signed, version {activeVersion.version}</Badge>
      ) : (
        <Badge variant="amber">Not signed yet: no limit can be set and nothing is checked</Badge>
      )}
      {shown && <RuleSummary config={shown.config} />}
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
                    {v.is_active ? <Badge variant="green">Active</Badge> : <Badge variant="grey">Not active</Badge>}
                    {v.approved_at ? <Badge variant="green">Signed</Badge> : <Badge variant="amber">Unsigned</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {v.notes && <p className="text-sm text-charcoal-ink/70">{v.notes}</p>}
                  <p className="text-xs text-charcoal-ink/50">Drafted {new Date(v.created_at).toLocaleString("en-GB")}</p>
                  {isSupersededVersion(v, activeVersion?.version) && (
                    <p className="text-xs text-charcoal-ink/50">
                      Superseded: a newer version is live, so this draft can no longer be signed.
                    </p>
                  )}
                  {!v.approved_at && !isSupersededVersion(v, activeVersion?.version) && (
                    <>
                      <p className="text-xs text-charcoal-ink/60">
                        Signing requires the active Chief Medical Officer account. A pharmacist should review the bounds first.
                      </p>
                      <SignButton rulesId={v.id} />
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

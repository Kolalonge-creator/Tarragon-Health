"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VersionHistoryList } from "@/components/shell/version-history-list";
import { isSupersededVersion } from "@/lib/clinical/refuse-superseded-draft";
import {
  createMedicineInteractionRulesDraftAction,
  signMedicineInteractionRulesAction,
  type CreateMedicineInteractionRulesDraftState,
  type SignMedicineInteractionRulesState,
} from "../medicine-interaction-rules/actions";

export type MedicineInteractionRule = {
  code: string;
  ingredientA: string;
  ingredientB: string;
  severity: "contraindicated" | "caution" | "info";
  source: string;
};

export type MedicineInteractionRulesVersionRow = {
  id: string;
  version: number;
  config: { rules: MedicineInteractionRule[] };
  notes: string | null;
  is_active: boolean;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
};

function SignButton({ rulesId }: { rulesId: string }) {
  const [state, action, pending] = useActionState<SignMedicineInteractionRulesState, FormData>(
    () => signMedicineInteractionRulesAction(rulesId),
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

function DraftForm() {
  const [state, action, pending] = useActionState<CreateMedicineInteractionRulesDraftState, FormData>(
    createMedicineInteractionRulesDraftAction,
    undefined
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Draft a new rule set</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <p className="text-sm text-charcoal-ink/70">
            Paste the rules as JSON: an object with a &quot;rules&quot; list. Each rule has a code, two different ingredient names
            (lower case, for example &quot;amoxicillin&quot;), a severity (contraindicated, caution or info) and a public source a
            reviewer can check. A pharmacist writes and checks the rules; this page does not suggest any.
          </p>
          <textarea
            name="rules_json"
            rows={8}
            aria-label="Rules as JSON"
            className="w-full rounded-md border border-mist-grey/60 p-2 font-mono text-xs"
            placeholder='{"rules": [ { "code": "...", "ingredientA": "...", "ingredientB": "...", "severity": "caution", "source": "https://..." } ]}'
          />
          <textarea
            name="notes"
            rows={2}
            aria-label="Notes (optional)"
            className="w-full rounded-md border border-mist-grey/60 p-2 text-sm"
            placeholder="Optional note for the record, for example who reviewed it."
          />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save as a draft"}
          </Button>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state?.success && <p className="text-sm text-brand-green">Draft saved. Review it below, then sign it to bring it into force.</p>}
        </form>
      </CardContent>
    </Card>
  );
}

function RuleList({ rules }: { rules: MedicineInteractionRule[] }) {
  if (rules.length === 0) return <p className="text-sm text-charcoal-ink/70">No rules. This version is empty and cannot be signed.</p>;
  return (
    <ul className="space-y-1 text-sm text-charcoal-ink/80">
      {rules.map((r) => (
        <li key={r.code}>
          <span className="font-medium">{r.ingredientA}</span> with <span className="font-medium">{r.ingredientB}</span> ({r.severity}) ·{" "}
          <span className="break-all text-xs">{r.source}</span>
        </li>
      ))}
    </ul>
  );
}

export function MedicineInteractionRulesManager({
  versions,
  activeVersion,
}: {
  versions: MedicineInteractionRulesVersionRow[];
  activeVersion: MedicineInteractionRulesVersionRow | null;
}) {
  return (
    <div className="space-y-6">
      {activeVersion ? (
        <Badge variant="green">Signed, version {activeVersion.version}</Badge>
      ) : (
        <Badge variant="amber">Nothing signed: no interaction rule is shown to anyone</Badge>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What signing this allows</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-charcoal-ink/80">
          <p>
            When someone adds a medicine and one of these ingredient pairs is present, they see a short, fixed message that says &quot;your
            care team&quot; and never tells them to stop anything. Adding the medicine is never blocked and nothing about a prescription changes.
          </p>
          <p className="text-xs text-charcoal-ink/60">
            Signing does not turn the check on. A separate go-live switch (&quot;Governed interaction rules when adding a medicine&quot;) stays off until you
            press it. No model is involved. The rule set starts empty; this build wrote none of its rules.
          </p>
        </CardContent>
      </Card>
      <DraftForm />
      {versions.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Version history</h2>
          <VersionHistoryList>
            {versions.map((v) => {
              const empty = v.config.rules.length === 0;
              return (
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
                    <RuleList rules={v.config.rules} />
                    <p className="text-xs text-charcoal-ink/50">Drafted {new Date(v.created_at).toLocaleString("en-GB")}</p>
                    {isSupersededVersion(v, activeVersion?.version) && (
                      <p className="text-xs text-charcoal-ink/50">Superseded: a newer version is live, so this draft can no longer be signed.</p>
                    )}
                    {!v.approved_at && !isSupersededVersion(v, activeVersion?.version) && !empty && (
                      <>
                        <p className="text-xs text-charcoal-ink/60">
                          Signing requires the active Chief Medical Officer account. A pharmacist should review every rule and its source first.
                        </p>
                        <SignButton rulesId={v.id} />
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </VersionHistoryList>
        </div>
      )}
    </div>
  );
}

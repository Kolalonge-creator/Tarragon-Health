"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useMedications } from "@/lib/queries/medications";
import { useCarePlansForManagement } from "@/lib/queries/care-plan-management";
import { listCareChanges, suggestNextStep, type SuggestNextStepResult } from "./actions";
import { ChangeCard } from "./change-card";
import { describeNoProposalReason } from "./change-model";
import { MedicineProposalForm, PlanSettingsProposalForm } from "./propose-forms";

type Mode = "none" | "medicine" | "target" | "schedule";

/**
 * S24: "Care plan changes" on the clinician chart. A change is a draft until a prescriber signs it, and a signed change only applies
 * when the patient confirms it in the app: nothing here changes what the patient takes or does. The list is an audited read; a refusal
 * is shown as unavailable, never as "no changes". Hidden for Care Coordinators by the page; `canAct` (prescribing authority) decides
 * whether the propose and sign controls show. The database is the real gate either way.
 */
export function CarePlanChangesPanel({ patientId, canAct }: { patientId: string; canAct: boolean }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("none");
  const [suggestion, setSuggestion] = useState<SuggestNextStepResult | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const changes = useQuery({
    queryKey: ["care-plan-changes", patientId],
    // Each read writes an audit row: no refetch on focus, no retry of a refusal.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () => {
      const result = await listCareChanges({ patientId });
      if (!result.ok) throw new Error(result.error);
      return result.changes;
    },
  });
  const medications = useMedications(patientId);
  const plans = useCarePlansForManagement(patientId);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["care-plan-changes", patientId] });
    void queryClient.invalidateQueries({ queryKey: ["medications", patientId] });
  };

  async function suggest() {
    setSuggesting(true);
    setSuggestion(null);
    const result = await suggestNextStep({ patientId });
    setSuggesting(false);
    setSuggestion(result);
    if (result.ok && result.kind === "proposed") refresh();
  }

  const list = changes.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Care plan changes</CardTitle>
        <CardDescription>
          A change starts as a draft. Once a prescriber signs it, the patient sees it in the app and chooses whether to accept it. Nothing changes for the patient until they confirm.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canAct ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={suggest} disabled={suggesting}>
              {suggesting ? "Checking..." : "Suggest next step"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMode("medicine")}>
              Propose a medicine change
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMode("target")}>
              Propose a target change
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMode("schedule")}>
              Propose a reading schedule change
            </Button>
          </div>
        ) : (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            You can read these changes. Proposing and signing is for a prescriber tied to this patient.
          </p>
        )}

        {suggestion && <SuggestionResult result={suggestion} />}

        {mode === "medicine" && (
          <MedicineProposalForm
            patientId={patientId}
            medications={medications.data ?? []}
            onCancel={() => setMode("none")}
            onDone={() => {
              setMode("none");
              refresh();
            }}
          />
        )}
        {(mode === "target" || mode === "schedule") && (
          plans.isLoading ? (
            <p className="text-sm text-charcoal-ink/60">Loading care plans...</p>
          ) : (
            <PlanSettingsProposalForm
              kind={mode}
              patientId={patientId}
              plans={plans.data ?? []}
              onCancel={() => setMode("none")}
              onDone={() => {
                setMode("none");
                refresh();
              }}
            />
          )
        )}

        {changes.isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading...</p>}
        {changes.isError && (
          <p role="alert" className="text-sm text-red-600">
            Care plan changes are not available to you for this patient, or could not be loaded. This does not mean there are none.
          </p>
        )}
        {!changes.isLoading && !changes.isError && list.length === 0 && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">No changes have been proposed for this patient yet.</p>
        )}
        {list.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
            {list.map((change) => (
              <ChangeCard key={change.id} change={change} patientId={patientId} canAct={canAct} onChanged={refresh} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SuggestionResult({ result }: { result: SuggestNextStepResult }) {
  if (!result.ok) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {result.error}
      </p>
    );
  }
  if (result.kind === "proposed") {
    return (
      <p role="status" className="rounded-md border border-brand-green/30 bg-brand-green/5 p-3 text-sm text-charcoal-ink dark:text-night-ink">
        A draft was added to the list below. Review what the engine saw, then sign or reject it. The patient cannot see it.
      </p>
    );
  }
  if (result.kind === "no_protocol") {
    return (
      <p role="status" className="rounded-md border border-charcoal-ink/10 p-3 text-sm text-charcoal-ink dark:border-night-ink/15 dark:text-night-ink">
        The Chief Medical Officer has not approved a step table yet, so no next step can be suggested. You can still propose a change by hand.
      </p>
    );
  }
  return (
    <div role="status" className="space-y-1 rounded-md border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">No next step was suggested, because:</p>
      <ul className="list-inside list-disc text-sm text-charcoal-ink/80 dark:text-night-ink/80">
        {result.reasons.map((reason, index) => (
          <li key={`${reason.code}-${index}`}>{describeNoProposalReason(reason)}</li>
        ))}
      </ul>
    </div>
  );
}

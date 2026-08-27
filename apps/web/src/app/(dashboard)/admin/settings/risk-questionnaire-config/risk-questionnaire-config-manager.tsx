"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  signRiskQuestionnaireConfigAction,
  type SignRiskQuestionnaireConfigState,
} from "./actions";

export type RiskQuestionnaireConfigRow = {
  id: string;
  version: number;
  config: unknown;
  notes: string | null;
  is_active: boolean;
  approved_at: string | null;
  created_at: string;
};

function questionAndConditionCounts(config: unknown): { questions: number; conditions: number } {
  const payload = config as { questions?: unknown[]; conditions?: unknown[] } | null;
  return {
    questions: Array.isArray(payload?.questions) ? payload.questions.length : 0,
    conditions: Array.isArray(payload?.conditions) ? payload.conditions.length : 0,
  };
}

function SignButton({ configId }: { configId: string }) {
  const [state, action, pending] = useActionState<SignRiskQuestionnaireConfigState, FormData>(
    () => signRiskQuestionnaireConfigAction(configId),
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

export function RiskQuestionnaireConfigManager({ configs }: { configs: RiskQuestionnaireConfigRow[] }) {
  if (configs.length === 0) {
    return (
      <p className="text-sm text-charcoal-ink/60">
        No risk questionnaire configuration found for your organisation.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {configs.map((c) => {
        const counts = questionAndConditionCounts(c.config);
        return (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Version {c.version}
                {c.is_active ? (
                  <Badge variant="green">Active, signed</Badge>
                ) : (
                  <Badge variant="grey">Draft, not in force</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {c.notes && <p className="text-sm text-charcoal-ink/70">{c.notes}</p>}
              <p className="text-xs text-charcoal-ink/60">
                {counts.questions} questions, {counts.conditions} risk conditions.
              </p>
              <details>
                <summary className="cursor-pointer text-xs text-charcoal-ink/60">
                  View full configuration
                </summary>
                <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-mist-grey/40 p-3 text-xs text-charcoal-ink/80">
                  {JSON.stringify(c.config, null, 2)}
                </pre>
              </details>
              {c.is_active ? (
                <p className="text-xs text-charcoal-ink/50">
                  In force since {c.approved_at ? new Date(c.approved_at).toLocaleString("en-GB") : "—"}.
                  While this is active, the risk assessment reads its questions and scoring rules
                  from here instead of the built-in fallback logic. To change any value, add a new
                  version below and sign it.
                </p>
              ) : (
                <>
                  <p className="text-xs text-charcoal-ink/60">
                    Review every question and scoring rule above. Signing requires an active
                    Clinical Director account and switches the live risk assessment onto this
                    version.
                  </p>
                  <SignButton configId={c.id} />
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { signCvRiskConfigAction, type SignCvRiskConfigState } from "./actions";

export type CvRiskConfigRow = {
  id: string;
  version: number;
  config: unknown;
  notes: string | null;
  is_active: boolean;
  approved_at: string | null;
  created_at: string;
};

function SignButton({ configId }: { configId: string }) {
  const [state, action, pending] = useActionState<SignCvRiskConfigState, FormData>(
    () => signCvRiskConfigAction(configId),
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

export function CvRiskConfigManager({ configs }: { configs: CvRiskConfigRow[] }) {
  if (configs.length === 0) {
    return (
      <p className="text-sm text-charcoal-ink/60">
        No CV-risk configuration found for your organisation.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {configs.map((c) => (
        <Card key={c.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Version {c.version}
              {c.is_active ? (
                <Badge variant="green">Active — signed</Badge>
              ) : (
                <Badge variant="grey">Draft — not in force</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {c.notes && <p className="text-sm text-charcoal-ink/70">{c.notes}</p>}
            <pre className="max-h-72 overflow-auto rounded-md bg-mist-grey/40 p-3 text-xs text-charcoal-ink/80">
              {JSON.stringify(c.config, null, 2)}
            </pre>
            {c.is_active ? (
              <p className="text-xs text-charcoal-ink/50">
                In force since {c.approved_at ? new Date(c.approved_at).toLocaleString("en-GB") : "—"}.
                To change any value, add a new version and sign it.
              </p>
            ) : (
              <>
                <p className="text-xs text-charcoal-ink/60">
                  Review every threshold and target above. Signing requires an active Clinical
                  Director account and brings these values into force for the CV-risk engine.
                </p>
                <SignButton configId={c.id} />
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

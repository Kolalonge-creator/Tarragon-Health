"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { signTriageProtocolAction, type SignTriageProtocolState } from "./actions";
import type { TriageProtocolConfig } from "@/lib/symptom-triage/types";

export type TriageProtocolRow = {
  id: string;
  version: number;
  config: TriageProtocolConfig;
  notes: string | null;
  is_active: boolean;
  approved_at: string | null;
  created_at: string;
};

const CATEGORY_BADGE: Record<string, "red" | "amber" | "blue" | "green"> = {
  emergency: "red",
  urgent: "amber",
  routine: "blue",
  self_management: "green",
};

function SignButton({ protocolId }: { protocolId: string }) {
  const [state, action, pending] = useActionState<SignTriageProtocolState, FormData>(
    () => signTriageProtocolAction(protocolId),
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

function PathwayReview({ pathway }: { pathway: TriageProtocolConfig["pathways"][number] }) {
  return (
    <div className="space-y-2 rounded-md border border-charcoal-ink/10 p-3">
      <p className="font-medium text-charcoal-ink">{pathway.label}</p>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
          Red-flag screen ({pathway.redFlagScreen.length}) — always checked first, before any question
        </p>
        <ul className="mt-1 space-y-1">
          {pathway.redFlagScreen.map((rf) => (
            <li key={rf.key} className="flex items-center gap-2 text-sm">
              <Badge variant={CATEGORY_BADGE[rf.category] ?? "grey"}>{rf.category}</Badge>
              <span className="text-charcoal-ink/80">{rf.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">
          Question tree ({Object.keys(pathway.nodes).length} nodes, starting at &quot;{pathway.startNodeKey}&quot;)
        </p>
        <ul className="mt-1 space-y-1.5">
          {Object.values(pathway.nodes).map((node) =>
            node.type === "question" ? (
              <li key={node.key} className="text-sm text-charcoal-ink/80">
                <span className="font-mono text-xs text-charcoal-ink/40">{node.key}</span> —{" "}
                <span className="italic">&quot;{node.prompt}&quot;</span>{" "}
                {node.kind === "boolean" ? (
                  <span className="text-xs text-charcoal-ink/50">
                    (yes → {node.onYes}, no → {node.onNo})
                  </span>
                ) : (
                  <span className="text-xs text-charcoal-ink/50">
                    ({node.options.map((o) => `"${o.label}" → ${o.next}`).join(", ")})
                  </span>
                )}
              </li>
            ) : (
              <li key={node.key} className="text-sm text-charcoal-ink/80">
                <span className="font-mono text-xs text-charcoal-ink/40">{node.key}</span> —{" "}
                <Badge variant={CATEGORY_BADGE[node.category] ?? "grey"}>{node.category}</Badge>{" "}
                {node.rationale}
                {node.clinicianReviewRequired && (
                  <span className="ml-1 text-xs text-charcoal-ink/50">(always notifies a clinician)</span>
                )}
              </li>
            )
          )}
        </ul>
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-charcoal-ink/50">Fallback</p>
        <p className="text-sm text-charcoal-ink/80">
          {pathway.fallbackOutcome.rationale}{" "}
          <Badge variant={CATEGORY_BADGE[pathway.fallbackOutcome.category] ?? "grey"}>
            {pathway.fallbackOutcome.category}
          </Badge>
        </p>
      </div>
    </div>
  );
}

export function TriageProtocolManager({ protocols }: { protocols: TriageProtocolRow[] }) {
  if (protocols.length === 0) {
    return <p className="text-sm text-charcoal-ink/60">No symptom-triage protocol has been drafted yet.</p>;
  }
  return (
    <div className="space-y-4">
      {protocols.map((p) => (
        <Card key={p.id}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Version {p.version}
              {p.is_active ? (
                <Badge variant="green">Active, signed</Badge>
              ) : (
                <Badge variant="grey">Draft, not in force</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {p.notes && <p className="text-sm text-charcoal-ink/70">{p.notes}</p>}
            <div className="space-y-3">
              {p.config.pathways.map((pathway) => (
                <PathwayReview key={pathway.key} pathway={pathway} />
              ))}
            </div>
            {p.is_active ? (
              <p className="text-xs text-charcoal-ink/50">
                In force since {p.approved_at ? new Date(p.approved_at).toLocaleString("en-GB") : "—"}.
              </p>
            ) : (
              <>
                <p className="text-xs text-charcoal-ink/60">
                  Review every red-flag rule and question above. Signing requires an active Clinical
                  Director account and immediately makes this the live decision tree the patient
                  symptom checker uses.
                </p>
                <SignButton protocolId={p.id} />
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

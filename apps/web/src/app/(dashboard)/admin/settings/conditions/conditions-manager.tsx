"use client";

import { useState } from "react";
import {
  useAllChronicProgrammes,
  useConditionProtocols,
  useSetChronicProgrammeActive,
  type ChronicProgramme,
  type ConditionProtocol,
} from "@/lib/queries/chronic-programmes";
import { useProtocolVersions, useCreateProtocolVersion } from "@/lib/queries/protocol-versions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConditionProtocolView } from "@/components/clinical/condition-protocol";

/** Inline "sign the WHO protocol" form — reuses useCreateProtocolVersion, which
 * enforces that the caller is the org's active Clinical Director. Signing
 * records an auditable protocol_versions row for the programme's protocol_slug,
 * which is exactly what the activation trigger checks for. */
function SignProtocolForm({
  programme,
  protocol,
  onSigned,
}: {
  programme: ChronicProgramme;
  protocol: ConditionProtocol | undefined;
  onSigned: () => void;
}) {
  const create = useCreateProtocolVersion();
  const [summary, setSummary] = useState(
    `Adopt WHO ${programme.name} protocol (${protocol?.source_reference ?? "WHO guidance"})`
  );

  return (
    <div className="space-y-2 rounded-md border border-charcoal-ink/10 bg-white p-3">
      <Label htmlFor={`sign-${programme.id}`}>Change summary (recorded on the signed version)</Label>
      <Input
        id={`sign-${programme.id}`}
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
      />
      {create.isError && (
        <p className="text-sm text-red-600">{(create.error as Error).message}</p>
      )}
      <Button
        disabled={create.isPending || summary.trim().length === 0}
        onClick={() =>
          create.mutate(
            {
              protocolId: programme.protocol_slug,
              title: `${programme.name} — WHO clinical protocol`,
              changeSummary: summary.trim(),
              content: protocol
                ? {
                    source: protocol.source,
                    source_reference: protocol.source_reference,
                    summary: protocol.summary,
                    prevention: protocol.prevention,
                    monitoring: protocol.monitoring,
                    investigations: protocol.investigations,
                    escalation: protocol.escalation,
                    follow_up: protocol.follow_up,
                  }
                : { note: "Signed without a seeded reference protocol." },
            },
            { onSuccess: onSigned }
          )
        }
      >
        {create.isPending ? "Signing…" : "Sign protocol"}
      </Button>
      <p className="text-xs text-charcoal-ink/50">
        Only the org&apos;s active Clinical Director can sign. Signing does not activate the
        condition on its own — you still switch it on below.
      </p>
    </div>
  );
}

function ProgrammeRow({
  programme,
  protocol,
  isSigned,
}: {
  programme: ChronicProgramme;
  protocol: ConditionProtocol | undefined;
  isSigned: boolean;
}) {
  const setActive = useSetChronicProgrammeActive();
  const [showProtocol, setShowProtocol] = useState(false);
  const [showSign, setShowSign] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            {programme.name}
            {programme.is_active ? (
              <Badge variant="green">Active</Badge>
            ) : (
              <Badge variant="grey">Dormant</Badge>
            )}
            {programme.launch_priority === 1 && <Badge variant="blue">Launch</Badge>}
            {isSigned ? (
              <Badge variant="green">Protocol signed</Badge>
            ) : (
              <Badge variant="amber">Protocol unsigned</Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {programme.is_active ? (
              <Button
                variant="outline"
                onClick={() =>
                  setActive.mutate({ id: programme.id, isActive: false })
                }
                disabled={setActive.isPending}
              >
                Deactivate
              </Button>
            ) : (
              <Button
                onClick={() => setActive.mutate({ id: programme.id, isActive: true })}
                disabled={setActive.isPending || !isSigned}
                title={isSigned ? undefined : "Sign the protocol before activating"}
              >
                {setActive.isPending ? "…" : "Activate"}
              </Button>
            )}
          </div>
        </div>
        <CardDescription>{programme.short_description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-charcoal-ink/60">
          {programme.category} · reviews every {programme.review_cadence_months} months ·
          monitors {programme.monitoring_vitals.join(", ") || "—"}
        </p>

        {setActive.isError && (
          <p className="text-sm text-red-600">{(setActive.error as Error).message}</p>
        )}

        <div className="flex flex-wrap gap-3 text-sm">
          {protocol && (
            <button
              type="button"
              className="font-medium text-brand-green hover:underline"
              onClick={() => setShowProtocol((v) => !v)}
            >
              {showProtocol ? "Hide WHO protocol" : "View WHO protocol"}
            </button>
          )}
          {!isSigned && (
            <button
              type="button"
              className="font-medium text-brand-green hover:underline"
              onClick={() => setShowSign((v) => !v)}
            >
              {showSign ? "Cancel signing" : "Sign protocol to enable activation"}
            </button>
          )}
        </div>

        {showProtocol && protocol && (
          <div className="rounded-md border border-charcoal-ink/10 bg-mist-grey/40 p-4">
            <ConditionProtocolView protocol={protocol} />
          </div>
        )}

        {showSign && !isSigned && (
          <SignProtocolForm
            programme={programme}
            protocol={protocol}
            onSigned={() => setShowSign(false)}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function ConditionsManager() {
  const programmes = useAllChronicProgrammes();
  const protocols = useConditionProtocols();
  const versions = useProtocolVersions();

  if (programmes.isLoading || protocols.isLoading || versions.isLoading) {
    return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  }
  if (programmes.isError || !programmes.data) {
    return <p className="text-sm text-red-600">Could not load chronic conditions.</p>;
  }

  const protocolByCondition = new Map(
    (protocols.data ?? []).map((p) => [p.condition, p])
  );
  const signedSlugs = new Set((versions.data ?? []).map((v) => v.protocol_id));

  return (
    <div className="space-y-4">
      {programmes.data.map((programme) => (
        <ProgrammeRow
          key={programme.id}
          programme={programme}
          protocol={protocolByCondition.get(programme.condition)}
          isSigned={signedSlugs.has(programme.protocol_slug)}
        />
      ))}
    </div>
  );
}

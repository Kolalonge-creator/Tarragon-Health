"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { attestPassportRequest, declinePassportRequest } from "./actions";
import { formatPassportDate } from "@/lib/health-passport/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface AttestationRequestItem {
  id: string;
  patientName: string;
  patientNumber: string | null;
  purpose: string;
  patientNote: string | null;
  requestedAt: string;
  /** Counts only, never values — see the page for why. */
  summary: {
    vitals: number;
    labs: number;
    screenings: number;
    reviewedEscalations: number;
    periodLabel: string;
  } | null;
}

function RequestRow({ item, canAttest }: { item: AttestationRequestItem; canAttest: boolean }) {
  const router = useRouter();
  const [statement, setStatement] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: async (decision: "attest" | "decline") => {
      const result =
        decision === "attest"
          ? await attestPassportRequest({ requestId: item.id, statement: statement.trim() })
          : await declinePassportRequest({ requestId: item.id, reason: reason.trim() });
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      setError(null);
      router.refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <li className="space-y-3 border-b border-charcoal-ink/10 py-5 last:border-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-sm font-semibold text-charcoal-ink">
          {item.patientName}
          {item.patientNumber ? ` · ${item.patientNumber}` : ""}
        </p>
        <span className="text-xs text-charcoal-ink/50">
          requested {formatPassportDate(item.requestedAt)}
        </span>
      </div>

      <p className="text-sm text-charcoal-ink/80">
        <span className="font-medium">For:</span> {item.purpose}
      </p>
      {item.patientNote && (
        <p className="text-sm text-charcoal-ink/60">&ldquo;{item.patientNote}&rdquo;</p>
      )}

      {/* The summary is built as one string rather than interleaved JSX: a line
          break between an expression and the text after it silently eats the
          space, which is how this line first rendered "0doctor-reviewed cases". */}
      {item.summary && (
        <p className="text-xs text-charcoal-ink/60">
          {`Record for ${item.summary.periodLabel}: ${item.summary.vitals} vitals, ` +
            `${item.summary.labs} lab results, ${item.summary.screenings} screenings, and ` +
            `${item.summary.reviewedEscalations} doctor-reviewed cases. Open the patient’s ` +
            `record to read the detail before attesting.`}
        </p>
      )}

      {canAttest ? (
        <div className="space-y-2 pt-1">
          <Input
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            placeholder="Optional statement, printed on the passport in your words"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => decide.mutate("attest")}
              disabled={decide.isPending}
            >
              Attest this record
            </Button>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason, if declining"
              className="max-w-xs"
            />
            <Button
              variant="outline"
              onClick={() => decide.mutate("decline")}
              disabled={decide.isPending || reason.trim().length < 3}
            >
              Decline
            </Button>
          </div>
          <p className="text-xs text-charcoal-ink/50">
            Attesting puts your name and registration number on a document the patient will give to
            an employer, a clinic or an embassy. It says the record is a true reflection of what
            TarragonHealth holds as at today. It does not say you examined this person.
          </p>
        </div>
      ) : null}

      {error && <p className="text-sm text-red-700">{error}</p>}
    </li>
  );
}

export function PassportAttestationList({
  items,
  canAttest,
  blockedReason,
}: {
  items: AttestationRequestItem[];
  canAttest: boolean;
  /** Why the controls are hidden, said plainly rather than left as a mystery. */
  blockedReason: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Waiting for review</CardTitle>
      </CardHeader>
      <CardContent>
        {blockedReason && (
          <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900">
            {blockedReason}
          </p>
        )}
        {items.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">
            No patients are waiting for a passport attestation.
          </p>
        ) : (
          <ul>
            {items.map((item) => (
              <RequestRow key={item.id} item={item} canAttest={canAttest} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

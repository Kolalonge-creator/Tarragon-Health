"use client";

import { receiptSentence } from "@tarragon/shared";
import { usePatientConsentReceipts } from "@/lib/queries/consent";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Consent receipts (S04b-2): one entry per grant or withdrawal, saying who, what, which version, when and where, with the
 * exact words that were shown. Receipts are append-only evidence: a withdrawal adds an entry, it never removes the grant.
 */
export function ConsentReceiptsPanel({ patientId }: { patientId: string }) {
  const receipts = usePatientConsentReceipts(patientId);
  const rows = receipts.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your consent receipts</CardTitle>
        <CardDescription>
          A record of every time you agreed to something or stopped it: the exact words you saw, when, and where. Nothing here is ever removed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {receipts.isLoading ? (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading your receipts...</p>
        ) : receipts.isError ? (
          <p role="alert" className="text-sm text-red-700">
            We could not load your receipts just now. Please refresh the page.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">No receipts yet.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
            {rows.map((r) => (
              <li key={r.id ?? `${r.consent_type}-${r.recorded_at}`} className="py-3">
                <p className="text-sm text-charcoal-ink dark:text-night-ink">
                  {receiptSentence({
                    action: r.action ?? "accepted",
                    title: r.title ?? "",
                    version: r.version ?? "",
                    recorded_at: r.recorded_at ?? "",
                    channel: r.channel ?? "unknown",
                    consented_by_relation: r.consented_by_relation ?? "legacy",
                  })}
                </p>
                <details className="mt-1 text-xs">
                  <summary className="cursor-pointer font-medium text-charcoal-ink/70 dark:text-night-ink/70">Show the exact words</summary>
                  <p className="mt-2 whitespace-pre-wrap text-charcoal-ink/80 dark:text-night-ink/80">{r.body}</p>
                  {r.text_sha256 ? (
                    <p className="mt-2 break-all text-charcoal-ink/50 dark:text-night-ink/55">Fingerprint of these words: {r.text_sha256}</p>
                  ) : (
                    <p className="mt-2 text-charcoal-ink/50 dark:text-night-ink/55">These are the words on file for that version. This record pre-dates receipts, so it has no fingerprint.</p>
                  )}
                </details>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

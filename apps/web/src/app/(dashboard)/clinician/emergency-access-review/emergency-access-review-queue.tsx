"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePendingEmergencyAccessReviews,
  useEmergencyAccessHistory,
  type EmergencyAccessGrant,
} from "@/lib/emergency-access/queries";
import { reviewEmergencyAccessAction } from "@/lib/emergency-access/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function shortDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function GrantSummary({ grant }: { grant: EmergencyAccessGrant }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <span className="font-medium text-charcoal-ink">
          {grant.patientName ?? "Unnamed patient"}
        </span>
        <span className="ml-2 text-sm text-charcoal-ink/60">
          requested by {grant.requesterName ?? "someone"}
        </span>
      </div>
      <span className="text-xs text-charcoal-ink/50">{shortDateTime(grant.grantedAt)}</span>
    </div>
  );
}

export function EmergencyAccessReviewQueue() {
  const qc = useQueryClient();
  const pending = usePendingEmergencyAccessReviews();
  const history = useEmergencyAccessHistory();
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["emergency-access"] });

  async function review(grantId: string, outcome: "reviewed_ok" | "reviewed_concern") {
    setBusy(grantId);
    setError(null);
    const res = await reviewEmergencyAccessAction(grantId, outcome, note[grantId] ?? "");
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    invalidate();
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Waiting on your review</CardTitle>
          <CardDescription>Nothing here can happen twice — each grant is reviewed once.</CardDescription>
        </CardHeader>
        <CardContent>
          {pending.isLoading ? (
            <p className="text-sm text-charcoal-ink/50">Loading…</p>
          ) : (pending.data ?? []).length === 0 ? (
            <p className="text-sm text-charcoal-ink/50">Nothing waiting on review.</p>
          ) : (
            <ul className="space-y-3">
              {(pending.data ?? []).map((grant) => (
                <li key={grant.id} className="rounded-lg border border-charcoal-ink/10 p-3">
                  <GrantSummary grant={grant} />
                  <p className="mt-1 text-sm text-charcoal-ink/70">Reason: {grant.reason}</p>
                  <p className="mt-1 text-xs text-charcoal-ink/50">
                    Expires {shortDateTime(grant.expiresAt)}
                  </p>
                  {grant.isOwnRequest ? (
                    <p className="mt-2 text-xs text-charcoal-ink/50">
                      You requested this — a different reviewer must confirm it.
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        className="min-w-0 flex-1 rounded-md border border-charcoal-ink/15 px-2 py-1 text-xs"
                        placeholder="Optional note"
                        value={note[grant.id] ?? ""}
                        onChange={(e) =>
                          setNote((prev) => ({ ...prev, [grant.id]: e.target.value }))
                        }
                      />
                      <Button
                        size="sm"
                        disabled={busy === grant.id}
                        onClick={() => review(grant.id, "reviewed_ok")}
                      >
                        {busy === grant.id ? "Working…" : "Confirm legitimate"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === grant.id}
                        onClick={() => review(grant.id, "reviewed_concern")}
                      >
                        Flag a concern
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reviewed</CardTitle>
        </CardHeader>
        <CardContent>
          {history.isLoading ? (
            <p className="text-sm text-charcoal-ink/50">Loading…</p>
          ) : (history.data ?? []).length === 0 ? (
            <p className="text-sm text-charcoal-ink/50">No reviewed requests yet.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {(history.data ?? []).map((grant) => (
                <li key={grant.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="text-sm text-charcoal-ink">
                      {grant.patientName ?? "Unnamed patient"}
                      <span className="ml-2 text-charcoal-ink/60">
                        · {grant.requesterName ?? "someone"}
                      </span>
                    </p>
                    <p className="text-xs text-charcoal-ink/50">
                      Reviewed by {grant.reviewedByName ?? "—"}
                      {grant.reviewNote && <span> · {grant.reviewNote}</span>}
                    </p>
                  </div>
                  <Badge variant={grant.reviewStatus === "reviewed_ok" ? "green" : "red"}>
                    {grant.reviewStatus === "reviewed_ok" ? "Confirmed legitimate" : "Flagged"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

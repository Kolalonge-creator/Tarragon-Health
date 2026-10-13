"use client";

import { useState } from "react";
import { DELETION_KEPT, DELETION_REMOVED, deletionGraceDays, deletionRequestView, formatLagosDate } from "@tarragon/shared";
import { useCancelDeletionRequest, useCreateDeletionRequest, usePatientDeletionRequests } from "@/lib/queries/data-rights";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FormError, fieldErrorId } from "@/components/ui/form-error";
import { mutationErrorMessage, STATUS_BADGE } from "./data-rights-common";

const OPEN = new Set(["pending", "under_review", "approved_partial", "approved_full"]);

/**
 * Close your account and erase what the law allows (OQ-50). The request waits a stated number of days so you can change
 * your mind and cancel; after that a person on our team reviews it. Clinical records, the audit log and financial ledger
 * entries are kept and this flow never deletes them; the card says so before you ask.
 */
export function DeletionRequestCard({ organisationId, patientId }: { organisationId: string; patientId: string }) {
  const requests = usePatientDeletionRequests(patientId);
  const create = useCreateDeletionRequest(organisationId, patientId);
  const cancel = useCancelDeletionRequest(patientId);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  const list = requests.data ?? [];
  const hasOpen = list.some((r) => OPEN.has(r.status));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Close my account and erase my data</CardTitle>
        <CardDescription>
          You can ask us to close your account. We wait {deletionGraceDays()} days first so you can change your mind, then our team reviews
          the request and tells you exactly what was done.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="font-medium text-charcoal-ink dark:text-night-ink">What we remove</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-charcoal-ink/80 dark:text-night-ink/80">
              {DELETION_REMOVED.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-medium text-charcoal-ink dark:text-night-ink">What we have to keep</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-charcoal-ink/80 dark:text-night-ink/80">
              {DELETION_KEPT.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              The law and clinical safety require these, so closing your account does not erase them.
            </p>
          </div>
        </div>

        {open ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="deletion-reason">Anything you would like us to know? (optional)</Label>
              <Textarea id="deletion-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <FormError id={fieldErrorId("deletion-request")} message={mutationErrorMessage(create.error)} />
            <div className="flex gap-2">
              <Button
                disabled={create.isPending}
                onClick={() => {
                  create.mutate(
                    { reason, requestedCategories: [] },
                    {
                      onSuccess: () => {
                        setOpen(false);
                        setReason("");
                      },
                    }
                  );
                }}
              >
                {create.isPending ? "Sending…" : `Yes, start the ${deletionGraceDays()}-day wait`}
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Not now
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" disabled={hasOpen} onClick={() => setOpen(true)}>
            {hasOpen ? "Request in progress" : "Close my account"}
          </Button>
        )}

        {requests.isError ? (
          <p role="alert" className="text-sm text-red-700">
            We could not load your requests just now. Please refresh the page.
          </p>
        ) : null}
        <FormError id={fieldErrorId("deletion-cancel")} message={mutationErrorMessage(cancel.error)} />

        {list.length > 0 ? (
          <ul className="space-y-3 border-t border-charcoal-ink/10 pt-3 text-sm dark:border-night-ink/15">
            {list.map((r) => {
              const view = deletionRequestView(r);
              return (
                <li key={r.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-charcoal-ink dark:text-night-ink">{view.headline}</span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">{formatLagosDate(r.requested_at)}</span>
                      <Badge variant={STATUS_BADGE[r.status] ?? "grey"}>{r.status.replace(/_/g, " ")}</Badge>
                    </div>
                  </div>
                  <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{view.detail}</p>
                  {r.status === "completed" || r.status === "approved_partial" || r.status === "denied" ? (
                    r.blocked_reason || r.decision_note ? (
                      <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">Note from our team: {r.blocked_reason ?? r.decision_note}</p>
                    ) : null
                  ) : null}
                  {view.canCancel ? (
                    confirmCancel === r.id ? (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate(r.id, { onSettled: () => setConfirmCancel(null) })}
                        >
                          Yes, cancel my request
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(null)}>
                          Keep it
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setConfirmCancel(r.id)}>
                        Cancel this request
                      </Button>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

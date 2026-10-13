"use client";

import { useState } from "react";
import { exportRequestView, formatLagosDate } from "@tarragon/shared";
import { useCreateExportRequest, usePatientExportRequests } from "@/lib/queries/data-rights";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FormError, fieldErrorId } from "@/components/ui/form-error";
import { mutationErrorMessage, STATUS_BADGE } from "./data-rights-common";

const OPEN = new Set(["pending", "under_review"]);

/**
 * Ask for a copy of your data (OQ-50). Two taps to ask, a stated timeline, a status you can come back to, and a download
 * when it is ready. A person on our team checks each request before anything is released, so this is not an instant
 * download; the database holds the clock (data_export_requests.due_at) and the download route
 * (/api/patient/data-export) refuses unless a request has been fulfilled.
 */
export function ExportRequestCard({ organisationId, patientId }: { organisationId: string; patientId: string }) {
  const requests = usePatientExportRequests(patientId);
  const create = useCreateExportRequest(organisationId, patientId);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  const list = requests.data ?? [];
  const hasOpen = list.some((r) => OPEN.has(r.status));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Get a copy of your data</CardTitle>
        <CardDescription>
          Ask for everything we hold about you. A person on our team checks every request before anything is released, so it is not an
          instant download. We aim to have it ready within 30 days, and often sooner. When it is ready you download it here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {open ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="export-note">Anything specific you need? (optional)</Label>
              <Textarea
                id="export-note"
                rows={2}
                placeholder="e.g. just my lab results, or everything"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <FormError id={fieldErrorId("export-request")} message={mutationErrorMessage(create.error)} />
            <div className="flex gap-2">
              <Button
                disabled={create.isPending}
                onClick={() => {
                  create.mutate(
                    { note: note || undefined },
                    {
                      onSuccess: () => {
                        setOpen(false);
                        setNote("");
                      },
                    }
                  );
                }}
              >
                {create.isPending ? "Sending…" : "Send request"}
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" disabled={hasOpen} onClick={() => setOpen(true)}>
            {hasOpen ? "Request in progress" : "Request my data"}
          </Button>
        )}

        {requests.isError ? (
          <p role="alert" className="text-sm text-red-700">
            We could not load your requests just now. Please refresh the page.
          </p>
        ) : null}

        {list.length > 0 ? (
          <ul className="space-y-3 border-t border-charcoal-ink/10 pt-3 text-sm dark:border-night-ink/15">
            {list.map((r) => {
              const view = exportRequestView(r);
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
                  {view.canDownload ? (
                    <a
                      href="/api/patient/data-export"
                      download
                      className="inline-block text-sm font-medium text-brand-green underline underline-offset-2 hover:no-underline"
                    >
                      Download my data
                    </a>
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

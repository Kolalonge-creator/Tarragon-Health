"use client";

import { useState } from "react";
import {
  usePatientDeletionRequests,
  useCreateDeletionRequest,
  usePatientCorrectionRequests,
  useCreateCorrectionRequest,
} from "@/lib/queries/data-rights";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge, type BadgeProps } from "@/components/ui/badge";

const STATUS_BADGE: Record<string, NonNullable<BadgeProps["variant"]>> = {
  pending: "amber",
  under_review: "blue",
  approved: "blue",
  approved_partial: "blue",
  approved_full: "blue",
  applied: "green",
  completed: "green",
  denied: "red",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function DataRightsPanel({
  organisationId,
  patientId,
}: {
  organisationId: string;
  patientId: string;
}) {
  const deletionRequests = usePatientDeletionRequests(patientId);
  const createDeletionRequest = useCreateDeletionRequest(organisationId, patientId);
  const correctionRequests = usePatientCorrectionRequests(patientId);
  const createCorrectionRequest = useCreateCorrectionRequest(organisationId, patientId);

  const [deletionOpen, setDeletionOpen] = useState(false);
  const [deletionReason, setDeletionReason] = useState("");

  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [recordDescription, setRecordDescription] = useState("");
  const [whatIsWrong, setWhatIsWrong] = useState("");
  const [requestedChange, setRequestedChange] = useState("");

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Request a correction</CardTitle>
          <CardDescription>
            See something wrong in your record? Tell us what it is. A member of your care team
            reviews every request before anything changes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {correctionOpen ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="correction-record">Which record?</Label>
                <Textarea
                  id="correction-record"
                  rows={2}
                  placeholder="e.g. my date of birth, a blood pressure reading from last week"
                  value={recordDescription}
                  onChange={(e) => setRecordDescription(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="correction-wrong">What&apos;s wrong with it?</Label>
                <Textarea
                  id="correction-wrong"
                  rows={2}
                  value={whatIsWrong}
                  onChange={(e) => setWhatIsWrong(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="correction-change">What should it say instead? (optional)</Label>
                <Textarea
                  id="correction-change"
                  rows={2}
                  value={requestedChange}
                  onChange={(e) => setRequestedChange(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={
                    !recordDescription.trim() ||
                    !whatIsWrong.trim() ||
                    createCorrectionRequest.isPending
                  }
                  onClick={() => {
                    createCorrectionRequest.mutate(
                      {
                        recordDescription,
                        whatIsWrong,
                        requestedChange: requestedChange || undefined,
                      },
                      {
                        onSuccess: () => {
                          setCorrectionOpen(false);
                          setRecordDescription("");
                          setWhatIsWrong("");
                          setRequestedChange("");
                        },
                      }
                    );
                  }}
                >
                  {createCorrectionRequest.isPending ? "Submitting…" : "Submit request"}
                </Button>
                <Button variant="ghost" onClick={() => setCorrectionOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setCorrectionOpen(true)}>
              Request a correction
            </Button>
          )}

          {(correctionRequests.data ?? []).length > 0 ? (
            <ul className="space-y-2 border-t border-charcoal-ink/10 pt-3 text-sm">
              {(correctionRequests.data ?? []).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-charcoal-ink/80">{r.record_description}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-charcoal-ink/50">
                      {formatDate(r.requested_at)}
                    </span>
                    <Badge variant={STATUS_BADGE[r.status] ?? "grey"}>
                      {r.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Request deletion of your data</CardTitle>
          <CardDescription>
            You can ask us to delete data we hold about you. Some clinical records must be kept
            for a minimum period under Nigerian healthcare regulation. If that applies, we&apos;ll
            explain exactly what can and can&apos;t be deleted when we review your request.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {deletionOpen ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="deletion-reason">
                  Tell us what you&apos;d like deleted and why (optional)
                </Label>
                <Textarea
                  id="deletion-reason"
                  rows={3}
                  value={deletionReason}
                  onChange={(e) => setDeletionReason(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={createDeletionRequest.isPending}
                  onClick={() => {
                    createDeletionRequest.mutate(
                      { reason: deletionReason, requestedCategories: [] },
                      {
                        onSuccess: () => {
                          setDeletionOpen(false);
                          setDeletionReason("");
                        },
                      }
                    );
                  }}
                >
                  {createDeletionRequest.isPending ? "Submitting…" : "Submit request"}
                </Button>
                <Button variant="ghost" onClick={() => setDeletionOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setDeletionOpen(true)}>
              Request deletion
            </Button>
          )}

          {(deletionRequests.data ?? []).length > 0 ? (
            <ul className="space-y-2 border-t border-charcoal-ink/10 pt-3 text-sm">
              {(deletionRequests.data ?? []).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-charcoal-ink/80">
                    {r.reason || "Deletion request"}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-charcoal-ink/50">
                      {formatDate(r.requested_at)}
                    </span>
                    <Badge variant={STATUS_BADGE[r.status] ?? "grey"}>
                      {r.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

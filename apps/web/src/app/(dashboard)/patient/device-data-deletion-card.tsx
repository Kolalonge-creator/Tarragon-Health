"use client";

import { useState } from "react";
import {
  usePatientDeletionRequests,
  useSubmitDeletionRequest,
  useCurrentRetentionPolicies,
} from "@/lib/queries/data-deletion-requests";
import {
  DATA_DELETION_SCOPE_ORDER,
  DATA_DELETION_SCOPE_LABEL,
  DATA_DELETION_SCOPE_DESCRIPTION,
  DATA_DELETION_SAFETY_NOTE,
  DATA_DELETION_STATUS_LABEL,
  DATA_DELETION_STATUS_BADGE_VARIANT,
  type DataDeletionScope,
} from "@/lib/device-data-deletion-labels";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { NAV_ICON } from "@/lib/icons";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Lagos",
  });
}

/**
 * Spec 55.19 — device/wearable data governance, patient side. Lets a patient
 * ask for their passive device/wearable data to be deleted at one of three
 * scopes, see the plain-language explanation of what each one actually does,
 * and track the status of requests they've already made. Processing happens
 * on the staff side via execute_wearable_data_deletion(); this only ever
 * inserts a device_data_deletion_requests row (RLS ties it to the caller's own
 * account — see data-deletion-requests.ts).
 */
export function DeviceDataDeletionCard({ patientId }: { patientId: string }) {
  const [scope, setScope] = useState<DataDeletionScope>("wearable_readings");
  const [reason, setReason] = useState("");
  const [justSubmitted, setJustSubmitted] = useState(false);

  const requests = usePatientDeletionRequests(patientId);
  const retentionPolicies = useCurrentRetentionPolicies();
  const submit = useSubmitDeletionRequest(patientId);

  const handleSubmit = () => {
    setJustSubmitted(false);
    submit.mutate(
      { scope, reason },
      {
        onSuccess: () => {
          setReason("");
          setJustSubmitted(true);
        },
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <NAV_ICON.security className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Manage my device data
        </CardTitle>
        <CardDescription>{DATA_DELETION_SAFETY_NOTE}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="grid gap-2">
            <Label htmlFor="deletion-scope">What would you like to delete?</Label>
            <Select
              id="deletion-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as DataDeletionScope)}
            >
              {DATA_DELETION_SCOPE_ORDER.map((s) => (
                <option key={s} value={s}>
                  {DATA_DELETION_SCOPE_LABEL[s]}
                </option>
              ))}
            </Select>
            <p className="text-xs text-charcoal-ink/60">{DATA_DELETION_SCOPE_DESCRIPTION[scope]}</p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="deletion-reason">Reason (optional)</Label>
            <Textarea
              id="deletion-reason"
              rows={3}
              placeholder="Tell us why, if you'd like. This is optional."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button disabled={submit.isPending} onClick={handleSubmit}>
              {submit.isPending ? "Submitting…" : "Request deletion"}
            </Button>
            {submit.isError && (
              <span className="text-sm text-red-600">
                {submit.error instanceof Error ? submit.error.message : "Couldn't submit"}
              </span>
            )}
          </div>
          {justSubmitted && (
            <p className="text-sm text-brand-green">
              Request submitted. Your care team will review and process it.
            </p>
          )}
        </div>

        <div className="space-y-2 border-t border-charcoal-ink/10 pt-4">
          <h4 className="text-sm font-semibold text-charcoal-ink">Your requests</h4>
          {requests.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
          {requests.isError && (
            <p className="text-sm text-red-600">Couldn&apos;t load your past requests.</p>
          )}
          {requests.data && requests.data.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">
              You haven&apos;t requested any device data deletions.
            </p>
          )}
          {requests.data && requests.data.length > 0 && (
            <ul className="space-y-2">
              {requests.data.map((r) => (
                <li key={r.id} className="rounded-lg border border-charcoal-ink/10 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-charcoal-ink">
                      {DATA_DELETION_SCOPE_LABEL[r.scope]}
                    </span>
                    <Badge variant={DATA_DELETION_STATUS_BADGE_VARIANT[r.status]}>
                      {DATA_DELETION_STATUS_LABEL[r.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-charcoal-ink/50">
                    Requested {formatDate(r.requested_at)}
                  </p>
                  {r.status === "rejected" && r.rejection_reason && (
                    <p className="mt-1 text-xs text-charcoal-ink/60">
                      Care team note: {r.rejection_reason}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {retentionPolicies.data && retentionPolicies.data.length > 0 && (
          <div className="space-y-2 border-t border-charcoal-ink/10 pt-4">
            <h4 className="text-sm font-semibold text-charcoal-ink">How long we keep this data</h4>
            <ul className="space-y-1.5 text-xs text-charcoal-ink/60">
              {retentionPolicies.data.map((p) => (
                <li key={p.id}>
                  <span className="font-medium text-charcoal-ink/80">
                    {p.data_category.replace(/_/g, " ")}:
                  </span>{" "}
                  {p.retention_period}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

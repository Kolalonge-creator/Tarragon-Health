"use client";

import { useState, type FormEvent } from "react";
import { useCreators, useSetCreatorStatus, type CreatorWithStaff } from "@/lib/queries/learning-centre";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STATUS: Record<string, { label: string; variant: "amber" | "green" | "red" }> = {
  pending: { label: "Waiting for approval", variant: "amber" },
  approved: { label: "Approved", variant: "green" },
  suspended: { label: "Suspended", variant: "red" },
};

function CreatorRow({ creator }: { creator: CreatorWithStaff }) {
  const setStatus = useSetCreatorStatus();
  const [reason, setReason] = useState("");
  const badge = STATUS[creator.status] ?? STATUS.pending!;
  const verified = !!creator.staff?.credential_verified_at && creator.staff.active;

  function decide(status: "approved" | "suspended") {
    setStatus.mutate({ id: creator.id, status, reason });
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-charcoal-ink">{creator.staff?.full_name ?? "Unknown clinician"}</p>
          <p className="text-xs text-charcoal-ink/60">
            {verified ? "Credential verified" : "Not currently verified"}
            {creator.bio ? ` · ${creator.bio}` : ""}
          </p>
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e: FormEvent) => e.preventDefault()}
      >
        <div className="space-y-1">
          <Label htmlFor={`r-${creator.id}`}>Reason (at least 10 characters, kept on record)</Label>
          <Input id={`r-${creator.id}`} className="w-80" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {creator.status !== "approved" && (
          <Button size="sm" disabled={setStatus.isPending || reason.trim().length < 10 || !verified} onClick={() => decide("approved")}>
            Approve
          </Button>
        )}
        {creator.status !== "suspended" && (
          <Button size="sm" variant="outline" disabled={setStatus.isPending || reason.trim().length < 10} onClick={() => decide("suspended")}>
            Suspend
          </Button>
        )}
      </form>
      {setStatus.isError && <p className="text-xs text-red-600">{(setStatus.error as Error).message}</p>}
    </li>
  );
}

/** Approve or suspend clinician creators (S55, 9.7). Admin or CMO. Verified clinicians only; no payouts or payment logic. */
export function CreatorAdmin() {
  const { data, isLoading, isError } = useCreators();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Clinician creators</CardTitle>
        <CardDescription>
          Verified clinicians who write learning series. Their pieces go through the same clinical review as everything else, are
          credited by name, and are a Members-only perk. A creator who stops being verified is hidden at once.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load creators.</p>}
        {data && data.length === 0 && <p className="text-sm text-charcoal-ink/60">No one has applied yet.</p>}
        {data && data.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((c) => (
              <CreatorRow key={c.id} creator={c} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

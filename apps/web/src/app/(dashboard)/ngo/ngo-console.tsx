"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type {
  FundingProgramme,
  FundingProgrammeInvitation,
  FundingProgrammeStats,
  FundingInvitationStatus,
  FundingProgrammeStatus,
} from "@/lib/ngo/funding-programmes";
import { inviteRosterAction, revokeInvitationAction } from "./actions";

const INVITATION_BADGE: Record<FundingInvitationStatus, "grey" | "green" | "amber" | "red"> = {
  invited: "grey",
  claimed: "green",
  expired: "amber",
  revoked: "red",
};

// Same four-way mapping as ngo-programmes-manager.tsx's STATUS_BADGE — kept
// in sync deliberately so the same programme.status renders identically in
// both the superadmin and the ngo_admin console rather than collapsing to
// just active/grey here (found in /code-review high before merge).
const PROGRAMME_STATUS_BADGE: Record<FundingProgrammeStatus, "grey" | "green" | "amber" | "red"> = {
  draft: "grey",
  active: "green",
  expired: "amber",
  cancelled: "red",
};

function ProgrammeCard({
  programme,
  stats,
  invitations,
}: {
  programme: FundingProgramme;
  stats: FundingProgrammeStats | null;
  invitations: FundingProgrammeInvitation[];
}) {
  const [feedback, setFeedback] = useState<{ error?: string; message?: string } | null>(null);
  const [roster, setRoster] = useState("");
  const [pending, startTransition] = useTransition();
  const [revoking, setRevoking] = useState<FundingProgrammeInvitation | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const router = useRouter();

  function submitRoster() {
    const formData = new FormData();
    formData.set("programmeId", programme.id);
    formData.set("roster", roster);
    startTransition(async () => {
      const result = await inviteRosterAction(undefined, formData);
      setFeedback(result ?? null);
      if (!result?.error) {
        setRoster("");
        router.refresh();
      }
    });
  }

  function confirmRevoke() {
    const target = revoking;
    setRevoking(null);
    if (!target) return;
    const formData = new FormData();
    formData.set("invitationId", target.id);
    formData.set("reason", revokeReason);
    startTransition(async () => {
      const result = await revokeInvitationAction(undefined, formData);
      setFeedback(result ?? null);
      setRevokeReason("");
      router.refresh();
    });
  }

  const canInvite = programme.status === "active";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>{programme.name}</CardTitle>
          <CardDescription>Contract {programme.contract_reference}</CardDescription>
        </div>
        <Badge variant={PROGRAMME_STATUS_BADGE[programme.status]}>{programme.status}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {stats && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-charcoal-ink/70 dark:text-night-ink/70 sm:grid-cols-4">
            <div>
              <dt className="text-xs uppercase text-charcoal-ink/50">Funded places</dt>
              <dd>{stats.fundedUnitCap}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-charcoal-ink/50">Invited</dt>
              <dd>{stats.invited}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-charcoal-ink/50">Claimed</dt>
              <dd>{stats.claimed}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-charcoal-ink/50">Remaining</dt>
              <dd>{stats.unitsRemaining}</dd>
            </div>
          </dl>
        )}

        {feedback?.error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{feedback.error}</p>
        )}
        {feedback?.message && (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{feedback.message}</p>
        )}

        {canInvite ? (
          <div className="space-y-1.5">
            <Label htmlFor={`roster-${programme.id}`}>Invite people — one per line</Label>
            <Textarea
              id={`roster-${programme.id}`}
              rows={4}
              value={roster}
              onChange={(e) => setRoster(e.target.value)}
              placeholder={"Full Name, +2348012345678\nFull Name, name@example.com"}
            />
            <p className="text-xs text-charcoal-ink/50">
              Full name, then a phone (E.164) or email — no other health or personal information.
            </p>
            <Button disabled={pending || !roster.trim()} onClick={submitRoster}>
              Send invitations
            </Button>
          </div>
        ) : (
          <p className="text-sm text-charcoal-ink/60">
            This programme is {programme.status} — invitations can only be sent while it&apos;s active.
          </p>
        )}

        {invitations.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-xs uppercase text-charcoal-ink/50 dark:border-night-ink/15">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Contact</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Invited</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {invitations.map((inv) => (
                  <tr key={inv.id} className="border-b border-charcoal-ink/5 dark:border-night-ink/10">
                    <td className="py-2 pr-4">{inv.full_name ?? "—"}</td>
                    <td className="py-2 pr-4">{inv.phone ?? inv.email ?? "—"}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={INVITATION_BADGE[inv.status]}>{inv.status}</Badge>
                    </td>
                    <td className="py-2 pr-4 text-charcoal-ink/60">
                      {new Date(inv.invited_at).toLocaleDateString()}
                    </td>
                    <td className="py-2 text-right">
                      {inv.status === "invited" && (
                        <Button variant="outline" size="sm" disabled={pending} onClick={() => setRevoking(inv)}>
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={revoking !== null}
        title="Revoke this invitation?"
        description={`${revoking?.full_name ?? "This person"} will no longer be able to claim the funded service. Their funded place goes back into the programme's remaining capacity.`}
        confirmLabel="Revoke invitation"
        cancelLabel="Cancel"
        destructive
        onConfirm={confirmRevoke}
        onCancel={() => {
          setRevoking(null);
          setRevokeReason("");
        }}
      >
        <div className="space-y-1.5 pt-2">
          <Label htmlFor="revoke-reason">Reason (optional)</Label>
          <Textarea
            id="revoke-reason"
            rows={2}
            value={revokeReason}
            onChange={(e) => setRevokeReason(e.target.value)}
            placeholder="Why this invitation is being revoked, for the audit log"
          />
        </div>
      </ConfirmDialog>
    </Card>
  );
}

export function NgoConsole({
  programmes,
  statsByProgrammeId,
  invitationsByProgrammeId,
}: {
  programmes: FundingProgramme[];
  statsByProgrammeId: Record<string, FundingProgrammeStats>;
  invitationsByProgrammeId: Record<string, FundingProgrammeInvitation[]>;
}) {
  return (
    <div className="space-y-4">
      {programmes.map((p) => (
        <ProgrammeCard
          key={p.id}
          programme={p}
          stats={statsByProgrammeId[p.id] ?? null}
          invitations={invitationsByProgrammeId[p.id] ?? []}
        />
      ))}
    </div>
  );
}

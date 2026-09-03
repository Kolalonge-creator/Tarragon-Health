"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  respondToCareAccessRequestAction,
  cancelCareAccessRequestAction,
} from "./care-access-actions";
import { inverseRelationship } from "@/lib/validation/care-access";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export interface CareAccessRequestRow {
  id: string;
  profile_id: string;
  counterparty_user_id: string;
  initiated_by: string;
  permission_level: "view" | "manage";
  relationship: string | null;
  created_at: string;
  owner_name: string | null;
  counterparty_name: string | null;
}

const LEVEL_LABEL: Record<"view" | "manage", string> = {
  view: "view",
  manage: "manage",
};

/**
 * Every still-pending care_access_requests row involving the caller, split
 * into the two shapes it can take:
 *
 *   needs my response   the caller did NOT initiate it — accepting is the
 *                        only path that turns the row into a real
 *                        profile_access grant (respond_to_care_access_request).
 *   waiting on them      the caller initiated it and the other party hasn't
 *                        responded yet — nothing to act on but withdraw it.
 *
 * Covers both the next-of-kin ('view') and eldercare ('manage') cases with
 * one component: which one a row is doesn't change how it's rendered, only
 * the wording.
 */
export function CareAccessRequestsList({
  requests,
  currentUserId,
}: {
  requests: CareAccessRequestRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needsMyResponse = requests.filter((r) => r.initiated_by !== currentUserId);
  const waitingOnThem = requests.filter((r) => r.initiated_by === currentUserId);

  if (requests.length === 0) return null;

  async function respond(id: string, accept: boolean) {
    setError(null);
    setPendingId(id);
    try {
      const result = await respondToCareAccessRequestAction(id, accept);
      if ("error" in result) setError(result.error);
      else router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  async function cancel(id: string) {
    setError(null);
    setPendingId(id);
    try {
      const result = await cancelCareAccessRequestAction(id);
      if ("error" in result) setError(result.error);
      else router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Requests</CardTitle>
        <CardDescription>
          Nothing here changes what anyone can see or do until both sides agree.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

        {needsMyResponse.map((r) => {
          const isAboutMyRecord = r.profile_id === currentUserId;
          const otherName = (isAboutMyRecord ? r.counterparty_name : r.owner_name) ?? "Someone";
          // r.relationship is always stored as "the counterparty's relation to
          // the owner" (see inverseRelationship's doc comment) — direct when
          // the viewer IS the owner, inverted when the viewer is the
          // counterparty, since the word was written from the other side.
          const displayedRelationship = r.relationship
            ? isAboutMyRecord
              ? r.relationship
              : inverseRelationship(r.relationship)
            : null;
          const text = isAboutMyRecord
            ? `${otherName} has asked to ${LEVEL_LABEL[r.permission_level]} your care${
                displayedRelationship ? ` (your ${displayedRelationship})` : ""
              }.`
            : `${otherName} wants you to be able to ${LEVEL_LABEL[r.permission_level]} their care${
                displayedRelationship ? ` (your ${displayedRelationship})` : ""
              }.`;
          return (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-3"
            >
              <p className="text-sm text-charcoal-ink dark:text-night-ink">{text}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={pendingId === r.id}
                  onClick={() => respond(r.id, true)}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pendingId === r.id}
                  onClick={() => respond(r.id, false)}
                >
                  Decline
                </Button>
              </div>
            </div>
          );
        })}

        {waitingOnThem.map((r) => {
          const isAboutMyRecord = r.profile_id === currentUserId;
          const otherName = (isAboutMyRecord ? r.counterparty_name : r.owner_name) ?? "them";
          const text = isAboutMyRecord
            ? `You offered ${otherName} the ability to ${LEVEL_LABEL[r.permission_level]} your care: waiting for them to accept.`
            : `You asked to ${LEVEL_LABEL[r.permission_level]} ${otherName}'s care: waiting for them to accept.`;
          return (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 bg-charcoal-ink/[0.02] dark:bg-night-ink/10 p-3"
            >
              <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{text}</p>
              <Button
                size="sm"
                variant="outline"
                disabled={pendingId === r.id}
                onClick={() => cancel(r.id)}
              >
                Withdraw
              </Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

"use client";

import { useState } from "react";
import { useMyCareFollowers, useSetClinicalAccess } from "@/lib/queries/care-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Who may read this person's health information, decided by them, one person at
 * a time.
 *
 * Being named next of kin, or agreeing that someone may book and pay on your
 * behalf, is not the same as handing them your readings and your prescriptions.
 * So the grant and the visibility are two separate switches, and this is the
 * second one. It starts off for everyone, including people who have held a
 * grant for months, and it comes back off the moment it is switched off:
 * private.can_read_clinical is read live by every policy it gates, so there is
 * no cached copy of the answer anywhere.
 *
 * Saying yes also puts them in conversations with the care team, which is the
 * point of saying yes at all for a family abroad — so the copy says so before
 * the click, not after.
 */
export function CareVisibilityList() {
  const { data: followers, isLoading, isError } = useMyCareFollowers();
  const setAccess = useSetClinicalAccess();
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isLoading || isError || !followers || followers.length === 0) {
    // Nothing to decide about until somebody actually holds a grant. The
    // next-of-kin and caregiver cards above are where that starts.
    return null;
  }

  const decide = (grantId: string, allow: boolean) => {
    setError(null);
    setAccess.mutate(
      { grantId, allow },
      {
        onSuccess: () => setOpenId(null),
        onError: (cause) =>
          setError(cause instanceof Error ? cause.message : "That did not save. Try again."),
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who can see your health information</CardTitle>
        <CardDescription>
          These people can already be contacted about you. Seeing your readings, medications and
          appointments is a separate yes, and it is yours to give or take back at any time. Tap a
          name to change it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {followers.map((follower) => {
            const name = follower.fullName ?? "Someone you have added";
            const open = openId === follower.grantId;
            return (
              <li key={follower.grantId} className="py-3">
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                  onClick={() => setOpenId(open ? null : follower.grantId)}
                  aria-expanded={open}
                >
                  <span className="font-medium text-charcoal-ink">{name}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant={follower.permissionLevel === "manage" ? "green" : "grey"}>
                      {follower.permissionLevel === "manage" ? "Can act for you" : "Next of kin"}
                    </Badge>
                    <Badge variant={follower.clinicalAccess ? "green" : "grey"}>
                      {follower.clinicalAccess
                        ? "Can see your health information"
                        : "Cannot see your health information"}
                    </Badge>
                  </span>
                </button>

                {open && (
                  <div className="mt-3 space-y-3 rounded-lg bg-charcoal-ink/5 p-4">
                    <p className="text-sm text-charcoal-ink/70">
                      Should {name} be able to see your readings, your medications, your care plan
                      and what is due next, and take part in your conversations with your care
                      team?
                    </p>
                    <p className="text-sm text-charcoal-ink/60">
                      They will never be able to change anything on your record, or end a
                      conversation you are having. You will see every message they send.
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={setAccess.isPending || follower.clinicalAccess}
                        onClick={() => decide(follower.grantId, true)}
                      >
                        Yes, they can
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={setAccess.isPending || !follower.clinicalAccess}
                        onClick={() => decide(follower.grantId, false)}
                      >
                        No, they cannot
                      </Button>
                    </div>
                    <p className="text-xs text-charcoal-ink/50">
                      Added {shortDate(follower.since)}.
                      {follower.clinicalAccessUpdatedAt
                        ? ` You last changed this on ${shortDate(follower.clinicalAccessUpdatedAt)}.`
                        : ""}
                    </p>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

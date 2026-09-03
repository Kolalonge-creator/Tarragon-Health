"use client";

import {
  useSexualHealthSharing,
  useGrantSexualHealthSharing,
  useRevokeSexualHealthSharing,
} from "@/lib/queries/adolescent-confidentiality";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * Lets the patient choose, one person at a time, whether a parent/guardian
 * who already has access to their record can also see their sexual &
 * reproductive health information (spec §49.4/§49.8). Off by default —
 * granting is always this patient's own act, never automatic and never
 * something staff or a parent can switch on for them (see the RLS insert
 * policy in the confidentiality-waivers migration).
 */
export function SharingCard() {
  const { data: grantees, isLoading, isError } = useSexualHealthSharing();
  const grant = useGrantSexualHealthSharing();
  const revoke = useRevokeSexualHealthSharing();

  if (isLoading) return null;
  if (isError) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-red-600 dark:text-red-400">
          Could not load your sharing settings.
        </CardContent>
      </Card>
    );
  }
  if (!grantees || grantees.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sharing your sexual &amp; reproductive health info</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          This is off by default and stays that way unless you turn it on. You can change your
          mind at any time.
        </p>
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {grantees.map((grantee) => {
            const isShared = grantee.waiverId !== null;
            const pending = grant.isPending || revoke.isPending;
            return (
              <li key={grantee.profileId} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-charcoal-ink dark:text-night-ink">{grantee.fullName ?? "Someone with access to your record"}</span>
                  <Badge variant={isShared ? "green" : "grey"}>{isShared ? "Sharing" : "Not shared"}</Badge>
                </div>
                {isShared ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => grantee.waiverId && revoke.mutate(grantee.waiverId)}
                  >
                    Stop sharing
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => grant.mutate(grantee.profileId)}
                  >
                    Share
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

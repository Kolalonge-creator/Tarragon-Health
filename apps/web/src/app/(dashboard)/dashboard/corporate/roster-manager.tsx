"use client";

import { useState, type FormEvent } from "react";
import {
  useEmployerRoster,
  useAddRosterMember,
  useClaimRosterMember,
  useRemoveRosterMember,
} from "@/lib/queries/employer-roster";
import { rosterMemberSchema } from "@/lib/validation/employer-roster";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * Full-population employer enrolment (docs/FULL_SPECIFICATION_V4.md §2.4/§8
 * — "corporate contracts that auto-enrol the whole workforce rather than
 * relying on elective sign-up"). Adds a roster entry by phone number; the
 * employee is attached to this organisation either immediately (if they've
 * already self-signed-up on the default consumer org — "Attach now") or
 * automatically the moment they sign up (private.handle_new_user). This is
 * additive, not a replacement for individual signup — nobody skips
 * onboarding, they just don't have to separately "join their employer" too.
 */
export function RosterManager({ organisationId }: { organisationId: string }) {
  const roster = useEmployerRoster(organisationId);
  const addMember = useAddRosterMember(organisationId);
  const claimMember = useClaimRosterMember(organisationId);
  const removeMember = useRemoveRosterMember(organisationId);
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [claimResult, setClaimResult] = useState<{ id: string; attached: boolean } | null>(null);

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    const parsed = rosterMemberSchema.safeParse({ phone, full_name: fullName });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setValidationError(null);
    addMember.mutate(parsed.data, {
      onSuccess: () => {
        setPhone("");
        setFullName("");
      },
    });
  }

  const mutationError =
    (addMember.error as Error | null)?.message ?? (removeMember.error as Error | null)?.message ?? null;
  const displayError = validationError ?? mutationError;

  const activeRows = (roster.data ?? []).filter((r) => r.status !== "removed");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.family className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Staff enrolment
        </CardTitle>
        <CardDescription>
          Add your workforce by phone number — they&apos;re attached to your organisation the moment they
          sign up, or immediately if they already have a Tarragon account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="roster_phone">Phone</Label>
            <Input
              id="roster_phone"
              placeholder="+2348012345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="roster_name">Name (optional)</Label>
            <Input id="roster_name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={addMember.isPending}>
            {addMember.isPending ? "Adding…" : "Add to roster"}
          </Button>
        </form>
        {displayError && <p className="text-sm text-red-600">{displayError}</p>}

        {roster.isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {activeRows.length === 0 && !roster.isLoading && (
          <p className="text-sm text-charcoal-ink/60">No one on your roster yet — add a phone number above.</p>
        )}
        {activeRows.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {activeRows.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-sm text-charcoal-ink">{member.full_name || member.phone}</p>
                  {member.full_name && <p className="text-xs text-charcoal-ink/60">{member.phone}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={member.status === "claimed" ? "green" : "grey"}>
                    {member.status === "claimed" ? "Enrolled" : "Pending signup"}
                  </Badge>
                  {member.status === "pending" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={claimMember.isPending}
                      onClick={() =>
                        claimMember.mutate(member.id, {
                          onSuccess: (attached) => setClaimResult({ id: member.id, attached }),
                        })
                      }
                    >
                      Attach now
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={removeMember.isPending}
                    onClick={() => removeMember.mutate(member.id)}
                  >
                    Remove
                  </Button>
                </div>
                {claimResult?.id === member.id && !claimResult.attached && (
                  <p className="w-full text-xs text-charcoal-ink/60">
                    No Tarragon account found with that number yet — they&apos;ll be attached automatically
                    once they sign up.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

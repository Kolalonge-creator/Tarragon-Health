"use client";

import { useState } from "react";
import {
  useMyCareFollowers,
  useSetClinicalAccess,
  useSetGranularPermissions,
  useSetExpiry,
  type CareFollower,
} from "@/lib/queries/care-access";
import {
  CAREGIVER_PERMISSIONS,
  CAREGIVER_PERMISSION_LABEL,
  CAREGIVER_ACCESS_DURATIONS,
  CAREGIVER_ACCESS_DURATION_LABEL,
  type CaregiverPermission,
  type CaregiverAccessDuration,
} from "@/lib/validation/care-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

/** "Permanent", "Expires in 6 days", "Expires today", "Expired". */
function expiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return "Permanent";
  const days = daysUntil(expiresAt);
  if (days < 0) return "Expired";
  if (days === 0) return "Expires today";
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
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
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant={follower.permissionLevel === "manage" ? "green" : "grey"}>
                      {follower.permissionLevel === "manage" ? "Can act for you" : "Next of kin"}
                    </Badge>
                    <Badge variant={follower.clinicalAccess ? "green" : "grey"}>
                      {follower.clinicalAccess
                        ? "Can see your health information"
                        : "Cannot see your health information"}
                    </Badge>
                    <Badge variant={follower.expiresAt ? "amber" : "grey"}>
                      {expiryLabel(follower.expiresAt)}
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

                    <AccessScopeEditor follower={follower} />
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

/** The bucket closest to whatever is actually stored, so reopening the editor doesn't silently default back to "permanent" against a grant that visibly expires soon. */
function nearestDuration(expiresAt: string | null): CaregiverAccessDuration {
  if (!expiresAt) return "permanent";
  const days = daysUntil(expiresAt);
  let closest: CaregiverAccessDuration = "permanent";
  let smallestDiff = Infinity;
  for (const option of CAREGIVER_ACCESS_DURATIONS) {
    if (option === "permanent") continue;
    const diff = Math.abs(Number(option) - days);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      closest = option;
    }
  }
  return closest;
}

/**
 * Narrowing what a 'manage' grantee can do, and how long any grant lasts —
 * the granular-permission and temporary-access half of 23.3/23.4, sitting
 * next to the clinical-visibility switch above rather than replacing it.
 * Permissions only apply to a 'manage' grant (a 'view' grant is already
 * read-only); duration applies to either.
 */
function AccessScopeEditor({ follower }: { follower: CareFollower }) {
  const setPermissions = useSetGranularPermissions();
  const setExpiry = useSetExpiry();
  const [selected, setSelected] = useState<CaregiverPermission[]>(
    follower.permissions ?? [...CAREGIVER_PERMISSIONS]
  );
  const [duration, setDuration] = useState<CaregiverAccessDuration>(nearestDuration(follower.expiresAt));
  const [savedPermissions, setSavedPermissions] = useState(false);
  const [savedDuration, setSavedDuration] = useState(false);

  function toggle(permission: CaregiverPermission) {
    setSavedPermissions(false);
    setSelected((current) =>
      current.includes(permission) ? current.filter((p) => p !== permission) : [...current, permission]
    );
  }

  function saveDuration(value: CaregiverAccessDuration) {
    setDuration(value);
    setSavedDuration(false);
    const expiresAt =
      value === "permanent"
        ? null
        : new Date(Date.now() + Number(value) * 24 * 60 * 60 * 1000).toISOString();
    setExpiry.mutate(
      { grantId: follower.grantId, expiresAt },
      { onSuccess: () => setSavedDuration(true) }
    );
  }

  return (
    <div className="space-y-3 border-t border-charcoal-ink/10 pt-3">
      {follower.permissionLevel === "manage" && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-charcoal-ink">What they can do</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {CAREGIVER_PERMISSIONS.map((permission) => (
              <li key={permission}>
                <label className="flex items-center gap-2 text-sm text-charcoal-ink/80">
                  <input
                    type="checkbox"
                    checked={selected.includes(permission)}
                    onChange={() => toggle(permission)}
                    className="h-4 w-4 rounded border-charcoal-ink/30 text-brand-green focus:ring-brand-green"
                  />
                  {CAREGIVER_PERMISSION_LABEL[permission]}
                </label>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={setPermissions.isPending || selected.length === 0}
              onClick={() =>
                setPermissions.mutate(
                  { grantId: follower.grantId, permissions: selected },
                  { onSuccess: () => setSavedPermissions(true) }
                )
              }
            >
              {setPermissions.isPending ? "Saving…" : "Save what they can do"}
            </Button>
            {savedPermissions && <span className="text-xs text-brand-green">Saved.</span>}
            {setPermissions.isError && (
              <span className="text-xs text-red-600">That did not save. Try again.</span>
            )}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor={`duration-${follower.grantId}`}>How long this lasts</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            id={`duration-${follower.grantId}`}
            value={duration}
            onChange={(event) => saveDuration(event.target.value as CaregiverAccessDuration)}
            className="max-w-xs"
          >
            {CAREGIVER_ACCESS_DURATIONS.map((value) => (
              <option key={value} value={value}>
                {CAREGIVER_ACCESS_DURATION_LABEL[value]}
              </option>
            ))}
          </Select>
          {setExpiry.isPending && <span className="text-xs text-charcoal-ink/50">Saving…</span>}
          {savedDuration && !setExpiry.isPending && (
            <span className="text-xs text-brand-green">Saved.</span>
          )}
        </div>
      </div>
    </div>
  );
}

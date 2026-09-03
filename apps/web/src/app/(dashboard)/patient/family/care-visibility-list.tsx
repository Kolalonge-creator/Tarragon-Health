"use client";

import { useState } from "react";
import {
  useMyCareFollowers,
  useSetCareAccessCategories,
  useSetGranularPermissions,
  useSetExpiry,
  CARE_ACCESS_CATEGORIES,
  type CareAccessCategory,
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

function toggled(categories: CareAccessCategory[], category: CareAccessCategory): CareAccessCategory[] {
  return categories.includes(category)
    ? categories.filter((c) => c !== category)
    : [...categories, category];
}

/**
 * Who may read this person's health information, and exactly which parts of
 * it, decided by them, one category at a time.
 *
 * Being named next of kin, or agreeing that someone may book and pay on your
 * behalf, is not the same as handing them your readings and your
 * prescriptions — and seeing your medications is not the same as seeing your
 * reproductive health record either. Every category starts off, including
 * for people who have held a grant for months, and comes back off the moment
 * it is switched off: private.can_read_clinical is read live by every policy
 * it gates, so there is no cached copy of the answer anywhere.
 *
 * Reproductive health is kept in its own section, deliberately separated
 * from the other seven — never just one more box in the same list — so
 * granting it is always its own decision, not something ticked along with
 * "appointments and medications" by habit.
 */
export function CareVisibilityList() {
  const { data: followers, isLoading, isError } = useMyCareFollowers();
  const setCategories = useSetCareAccessCategories();
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isLoading || isError || !followers || followers.length === 0) {
    // Nothing to decide about until somebody actually holds a grant. The
    // next-of-kin and caregiver cards above are where that starts.
    return null;
  }

  const setAll = (grantId: string, categories: CareAccessCategory[]) => {
    setError(null);
    setCategories.mutate(
      { grantId, categories },
      {
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
          These people can already be contacted about you. Seeing any part of your record is a
          separate yes, category by category, and it is yours to give or take back at any time.
          Tap a name to change it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {followers.map((follower) => {
            const name = follower.fullName ?? "Someone you have added";
            const open = openId === follower.grantId;
            const reproductiveHealthOn = follower.categories.includes("reproductive_health");
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
                    <Badge variant={follower.categories.length > 0 ? "green" : "grey"}>
                      {follower.categories.length === 0
                        ? "Cannot see your health information"
                        : `Can see ${follower.categories.length} of 8`}
                    </Badge>
                    <Badge variant={follower.expiresAt ? "amber" : "grey"}>
                      {expiryLabel(follower.expiresAt)}
                    </Badge>
                  </span>
                </button>

                {open && (
                  <div className="mt-3 space-y-4 rounded-lg bg-charcoal-ink/5 p-4">
                    <p className="text-sm text-charcoal-ink/70">
                      Tick what {name} should be able to see. They will never be able to change
                      anything on your record, or end a conversation you are having. You will see
                      every message they send.
                    </p>

                    <div className="space-y-2">
                      {CARE_ACCESS_CATEGORIES.map((cat) => (
                        <label
                          key={cat.value}
                          className="flex items-center gap-2 text-sm text-charcoal-ink"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-charcoal-ink/30"
                            checked={follower.categories.includes(cat.value)}
                            disabled={setCategories.isPending}
                            onChange={() =>
                              setAll(follower.grantId, toggled(follower.categories, cat.value))
                            }
                          />
                          {cat.label}
                        </label>
                      ))}
                    </div>

                    <div className="rounded-lg border border-charcoal-ink/10 bg-white p-3">
                      <label className="flex items-center gap-2 text-sm font-medium text-charcoal-ink">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-charcoal-ink/30"
                          checked={reproductiveHealthOn}
                          disabled={setCategories.isPending}
                          onChange={() =>
                            setAll(
                              follower.grantId,
                              toggled(follower.categories, "reproductive_health")
                            )
                          }
                        />
                        Reproductive health
                      </label>
                      <p className="mt-1 text-xs text-charcoal-ink/60">
                        Kept separate on purpose — turning on everything else above never
                        includes this. Cycle, pregnancy and related information stays private
                        unless you choose to share it here too.
                      </p>
                    </div>

                    <p className="text-xs text-charcoal-ink/50">Added {shortDate(follower.since)}.</p>
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

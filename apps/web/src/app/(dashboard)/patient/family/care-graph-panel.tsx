"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useCareGraph,
  useRevokeCareAccess,
  useSetGraphClinicalAccess,
  type PersonWithAccess,
  type PersonFundingMe,
  type RecordICanSee,
} from "@/lib/queries/care-graph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Everyone around one person's care, on one screen, with the take-back next to
 * each of them.
 *
 * This replaces CareVisibilityList (which could turn health visibility on and
 * off but could not remove anybody) and AdultsYouManageList (a bare list of
 * names). Both were fragments of the same question. The two things they could
 * not do between them are the two things that matter most:
 *
 *   - Remove a 'manage' grant. Revocation existed in the server action layer
 *     but was wired only to the next-of-kin card, so the most powerful grant on
 *     the platform — the one that can order medication and spend money — had no
 *     take-back button anywhere in the product.
 *
 *   - Show a person who is FUNDING this care without holding any grant. There
 *     was no query for it and no screen for it. Someone could be paying for
 *     your treatment and you would never be told.
 *
 * Everything renders from public.my_care_graph(), which derives the caller from
 * auth.uid() inside the database. This component decides layout and wording; it
 * decides nothing about access.
 */

function shortDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function naira(kobo: number): string {
  return `₦${Math.round(kobo / 100).toLocaleString("en-NG")}`;
}

function PersonRow({ person }: { person: PersonWithAccess }) {
  const [open, setOpen] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setAccess = useSetGraphClinicalAccess();
  const revoke = useRevokeCareAccess();

  const busy = setAccess.isPending || revoke.isPending;

  const decide = (allow: boolean) => {
    setError(null);
    setAccess.mutate(
      { grantId: person.grantId, allow },
      {
        onError: (cause) =>
          setError(cause instanceof Error ? cause.message : "That did not save. Try again."),
      }
    );
  };

  const doRevoke = () => {
    setError(null);
    revoke.mutate(person.grantId, {
      onSuccess: () => setConfirmingRevoke(false),
      onError: (cause) =>
        setError(cause instanceof Error ? cause.message : "That did not save. Try again."),
    });
  };

  return (
    <li className="py-4">
      {/* The label is spelled out rather than left to the nested spans: a screen
          reader announcing "button" with no name is useless, and the visible
          text alone does not compute into an accessible name reliably here. */}
      <button
        type="button"
        className="flex w-full flex-wrap items-start justify-between gap-3 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`Change what ${person.name} can see, or remove them`}
      >
        <span className="min-w-0">
          <span className="block font-medium text-charcoal-ink">{person.name}</span>
          <span className="block text-xs text-charcoal-ink/60">
            {person.lastActiveAt
              ? `Last looked at your care on ${shortDate(person.lastActiveAt)}`
              : "Has not opened your care yet"}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant={person.permissionLevel === "manage" ? "green" : "grey"}>
            {person.permissionLevel === "manage" ? "Can act for you" : "Can follow along"}
          </Badge>
          <Badge variant={person.clinicalAccess ? "green" : "grey"}>
            {person.clinicalAccess ? "Sees your health information" : "No health information"}
          </Badge>
          {person.fundsMe && <Badge variant="grey">Helps pay</Badge>}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-4 rounded-lg bg-charcoal-ink/5 p-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-charcoal-ink">
              Should {person.name} be able to see your health information?
            </p>
            <p className="text-sm text-charcoal-ink/70">
              That means your readings, your medications, your care plan and what is due next, and
              taking part in your conversations with your care team. They will never be able to
              change anything on your record, or end a conversation you are having.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy || person.clinicalAccess}
                onClick={() => decide(true)}
              >
                Yes, they can
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !person.clinicalAccess}
                onClick={() => decide(false)}
              >
                No, they cannot
              </Button>
            </div>
          </div>

          <div className="space-y-2 border-t border-charcoal-ink/10 pt-3">
            {person.permissionLevel === "manage" && (
              <p className="text-sm text-charcoal-ink/70">
                {person.name} can also book appointments, order repeat prescriptions and settle
                bills for you.
              </p>
            )}
            {confirmingRevoke ? (
              <div className="space-y-2">
                <p className="text-sm text-charcoal-ink">
                  Remove {person.name} completely? They will lose access straight away, and we will
                  let them know.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" disabled={busy} onClick={doRevoke}>
                    Yes, remove them
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirmingRevoke(false)}
                  >
                    Keep them
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmingRevoke(true)}
              >
                Remove {person.name}
              </Button>
            )}
          </div>

          <p className="text-xs text-charcoal-ink/50">
            Added {shortDate(person.since)}.
            {person.clinicalAccessChangedAt
              ? ` You last changed what they can see on ${shortDate(person.clinicalAccessChangedAt)}.`
              : ""}
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </li>
  );
}

function FunderRow({ funder }: { funder: PersonFundingMe }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div className="min-w-0">
        <p className="font-medium text-charcoal-ink">{funder.name}</p>
        <p className="text-xs text-charcoal-ink/60">
          {funder.fundsMyPlan ? "Pays for your plan" : "Has bought care for you"}
          {funder.totalKobo > 0 ? ` · ${naira(funder.totalKobo)} so far` : ""}
          {funder.lastPaidAt ? ` · last on ${shortDate(funder.lastPaidAt)}` : ""}
        </p>
      </div>
      <Badge variant={funder.holdsAccess ? "grey" : "amber"}>
        {funder.holdsAccess ? "Also follows your care" : "Cannot see your record"}
      </Badge>
    </li>
  );
}

function MirrorRow({ record }: { record: RecordICanSee }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revoke = useRevokeCareAccess();

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div className="min-w-0">
        <p className="font-medium text-charcoal-ink">{record.name}</p>
        <p className="text-xs text-charcoal-ink/60">
          {record.isDependentAccount
            ? "A child whose record you keep"
            : record.permissionLevel === "manage"
              ? "You can act on their care"
              : "You can follow their care"}
          {record.clinicalAccess ? " · you can see their health information" : ""}
        </p>
      </div>
      {/* A guardian cannot step away from a child who has no login of their own —
          there would be nobody left holding the record. Every other grant is
          the holder's to hand back without having to ask. */}
      {!record.isDependentAccount &&
        (confirming ? (
          <span className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={revoke.isPending}
              onClick={() =>
                revoke.mutate(record.grantId, {
                  onError: (cause) =>
                    setError(cause instanceof Error ? cause.message : "That did not work."),
                })
              }
            >
              Yes, step away
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={revoke.isPending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </span>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(true)}>
            Step away
          </Button>
        ))}
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </li>
  );
}

export function CareGraphPanel() {
  const { data: graph, isLoading, isError } = useCareGraph();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-charcoal-ink/60">Loading your people…</CardContent>
      </Card>
    );
  }

  if (isError || !graph) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-red-600">
          We could not load who has access to your care. Please refresh.
        </CardContent>
      </Card>
    );
  }

  const { peopleWithAccess, peopleFundingMe, recordsICanSee, careTeam } = graph;
  const fundersWithoutAccess = peopleFundingMe.filter((f) => !f.holdsAccess);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Who can see your care</CardTitle>
          <CardDescription>
            Everyone here was added by you and can be removed by you, at any time, without giving a
            reason. Tap a name to change what they can see or to remove them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {peopleWithAccess.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">
              Nobody else can see your care right now. Your care team can, and that is all.
            </p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {peopleWithAccess.map((person) => (
                <PersonRow key={person.grantId} person={person} />
              ))}
            </ul>
          )}

          {/* The care team is on this list on purpose. Leaving it off would let
              the page imply that the only people who can see this record are
              the ones the patient invited, which is not true and would be a
              strange thing for a consent screen to be coy about. */}
          <div className="mt-4 rounded-lg border border-charcoal-ink/10 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-charcoal-ink">Your Tarragon care team</p>
              <Badge variant="grey">Part of your care</Badge>
            </div>
            <p className="mt-1 text-sm text-charcoal-ink/70">
              The doctors and coordinators looking after you can see your record. That is how the
              care works, so it is not something you can switch off while you are with us.
              {careTeam.doctorsWhoReviewedMe > 0
                ? ` ${careTeam.doctorsWhoReviewedMe} ${
                    careTeam.doctorsWhoReviewedMe === 1 ? "doctor has" : "doctors have"
                  } reviewed something on your record, and each review is signed with their name.`
                : ""}
            </p>
          </div>
        </CardContent>
      </Card>

      {fundersWithoutAccess.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Who is helping pay</CardTitle>
            <CardDescription>
              Paying for your care gives nobody the right to read it. These people have put money
              toward your treatment and cannot see your record unless you add them above.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-charcoal-ink/10">
              {fundersWithoutAccess.map((funder) => (
                <FunderRow key={funder.profileId} funder={funder} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {recordsICanSee.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>People whose care you can see</CardTitle>
            <CardDescription>
              The other side of the same arrangement. You can hand any of these back yourself
              without having to ask them to remove you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-charcoal-ink/10">
              {recordsICanSee.map((record) => (
                <MirrorRow key={record.grantId} record={record} />
              ))}
            </ul>
            <p className="mt-3 text-sm text-charcoal-ink/60">
              To see what their care has actually involved, and what your money paid for, go to{" "}
              <Link href="/patient/supporting" className="text-brand-green underline">
                people you support
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

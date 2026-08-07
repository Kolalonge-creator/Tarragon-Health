"use client";

import { useActionState } from "react";
import { confirmPassportIdentity } from "../actions";
import type { PassportVerification } from "@/lib/health-passport/verify";

/**
 * "Is this the person in front of me?"
 *
 * The second half of the verification a real institution needs. Confirming the
 * document is genuine is not enough on its own — a genuine document belonging to
 * somebody else is the obvious attack, and the one an admissions officer or a
 * triage nurse most needs protecting from.
 *
 * The design is a knowledge check rather than a disclosure: the page shows a
 * masked name to anyone, and reveals the full legal name only to someone who can
 * already state the date of birth printed on the document they are holding. A
 * link that leaks, or a reference guessed at random, therefore identifies
 * nobody. Wrong guesses are throttled in the database, so this stays cheap for
 * the person reading it off the page and useless to anyone working through
 * possible dates.
 */
export function IdentityCheck({
  serial,
  initial,
}: {
  serial: string;
  initial: PassportVerification;
}) {
  const [state, action, pending] = useActionState(confirmPassportIdentity, null);
  const result = state ?? initial;

  if (result.identityConfirmed && result.subjectName) {
    return (
      <div className="rounded-lg border border-brand-green/40 bg-brand-green/5 p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-green">
          Identity confirmed
        </p>
        <p className="mt-2 text-xl font-semibold text-charcoal-ink">{result.subjectName}</p>
        {result.subjectPatientRef && (
          <p className="mt-1 text-sm text-charcoal-ink/60">
            Patient reference {result.subjectPatientRef}
          </p>
        )}
        <p className="mt-3 text-sm text-charcoal-ink/70">
          The date of birth you entered matches the one this document was issued against. Check
          that the name above is the person in front of you and matches the document you are
          holding.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-charcoal-ink/15 p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-charcoal-ink/50">
        Confirm who it belongs to
      </p>
      <p className="mt-2 text-sm text-charcoal-ink/70">
        This record was issued to{" "}
        <span className="font-semibold text-charcoal-ink">
          {result.subjectNameMasked ?? "a TarragonHealth patient"}
        </span>
        {result.subjectYearOfBirth ? `, born in ${result.subjectYearOfBirth}` : ""}. Enter the full
        date of birth printed on the document to see the full name.
      </p>

      <form action={action} className="mt-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="serial" value={serial} />
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-charcoal-ink/60">Date of birth</span>
          <input
            type="date"
            name="dob"
            required
            className="rounded-md border border-charcoal-ink/20 px-3 py-2 text-sm text-charcoal-ink"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Checking..." : "Check"}
        </button>
      </form>

      {result.identityRejected && (
        <p className="mt-3 text-sm text-red-700">
          That date of birth does not match this document. Check it against the first page and try
          again. Repeated attempts are limited.
        </p>
      )}
      <p className="mt-3 text-xs text-charcoal-ink/50">
        Nothing you enter here is stored. The patient is told that their record was checked, but
        not by whom.
      </p>
    </div>
  );
}

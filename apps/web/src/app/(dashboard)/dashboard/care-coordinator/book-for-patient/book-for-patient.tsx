"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BookAppointment } from "@/app/(dashboard)/patient/appointments/book-appointment";
import { findPatients, type FoundPatient } from "./actions";
import { CoordinatorTermsNote } from "./coordinator-terms-note";
import { PayLinkPanel } from "./pay-link-panel";
import { PhoneBookingsList } from "./phone-bookings-list";

/**
 * Find the patient the coordinator is talking to, then book for them with the same picker a patient uses. Free patients can still
 * be found: the database refuses a paid item for them and the message tells the coordinator they need to join Membership first.
 */
export function BookForPatient({ organisationId }: { organisationId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoundPatient[] | null>(null);
  const [selected, setSelected] = useState<FoundPatient | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSelected(null);
    const r = await findPatients({ query });
    setBusy(false);
    if ("error" in r) {
      setError(r.error);
      setResults(null);
    } else {
      setResults(r.patients);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Book for a patient on a call</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            Find the patient by name or phone number. Before you book, confirm you are speaking to them: ask for their full name and date of
            birth and check the number you are on matches the one shown.
          </p>
          <form onSubmit={search} className="flex flex-wrap gap-2">
            <label htmlFor="patient-search" className="sr-only">
              Name or phone number
            </label>
            <Input
              id="patient-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or phone number"
              className="max-w-sm"
            />
            <Button type="submit" disabled={busy || query.trim().length < 3}>
              {busy ? "Searching…" : "Find patient"}
            </Button>
          </form>
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {results && results.length === 0 && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">No patient matches that.</p>}
          {results && results.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
              {results.map((p) => (
                <li key={p.patientId} className="flex flex-wrap items-center gap-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{p.fullName}</p>
                    <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
                      {p.state ?? "State not recorded"} ·{" "}
                      {p.phone ? (
                        <a className="underline" href={`tel:${p.phone}`}>
                          {p.phone}
                        </a>
                      ) : (
                        "No phone on file"
                      )}{" "}
                      · {p.membershipTier === "plus" ? "Membership Plus" : p.membershipTier ? "Membership" : "Free"}
                    </p>
                  </div>
                  <Button size="sm" className="ml-auto" variant={selected?.patientId === p.patientId ? "outline" : "default"} onClick={() => setSelected(p)}>
                    {selected?.patientId === p.patientId ? "Selected" : "Book for this patient"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <PhoneBookingsList />

      {selected && (
        <div className="space-y-3">
          <p className="text-sm text-charcoal-ink dark:text-night-ink">
            Booking for <strong>{selected.fullName}</strong>
            {selected.membershipTier ? "" : ". This patient is on the Free plan, so a paid extra needs them to join Membership first."}
          </p>
          <BookAppointment
            key={selected.patientId}
            organisationId={organisationId}
            patientId={selected.patientId}
            renderTerms={(type) => (
              <CoordinatorTermsNote appointmentType={type} patientName={selected.fullName} isMember={selected.membershipTier !== null} />
            )}
            renderPendingPayment={(held) => (
              <PayLinkPanel appointmentId={held.appointmentId} slotStart={held.slotStart} patientName={selected.fullName} />
            )}
          />
        </div>
      )}
    </div>
  );
}

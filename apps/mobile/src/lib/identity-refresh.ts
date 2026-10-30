import type { PatientIdentity } from "@/lib/identity";

/** Auth events after which a signed-in person's role, organisation or name may have changed on the server. */
const REFRESH_EVENTS = new Set(["SIGNED_IN", "USER_UPDATED", "TOKEN_REFRESHED"]);

/** The most often identity is re-read in the background. A burst of auth events must not become a burst of profile queries. */
export const IDENTITY_REFRESH_MIN_GAP_MS = 60_000;

export function eventMayChangeIdentity(event: string): boolean {
  return REFRESH_EVENTS.has(event);
}

export function sameIdentity(a: PatientIdentity | null | undefined, b: PatientIdentity | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.fullName === b.fullName && a.patientNumber === b.patientNumber && a.organisationId === b.organisationId && a.initials === b.initials && a.role === b.role
    && a.sex === b.sex && a.dateOfBirth === b.dateOfBirth && a.receivesCare === b.receivesCare && a.isDependent === b.isDependent;
}

/**
 * What identity state to hold after a quiet background re-read. A failed or empty read (null, offline) keeps what is held, so a hiccup
 * never signs anyone out; an unchanged read keeps the same object, so nothing keyed on it restarts; a real change replaces it.
 */
export function nextIdentity(previous: PatientIdentity | null | undefined, reloaded: PatientIdentity | null): PatientIdentity | null | undefined {
  if (!reloaded) return previous;
  return sameIdentity(previous, reloaded) ? previous : reloaded;
}

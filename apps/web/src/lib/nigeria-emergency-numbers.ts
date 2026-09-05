import { NIGERIAN_STATES } from "@/lib/nigeria-states";

/**
 * Emergency contact numbers shown on the patient-facing emergency safety net
 * (see emergency-alert.tsx). Getting one of these wrong is a real-harm
 * scenario, not a cosmetic bug, so this list is deliberately conservative:
 *
 * - 112 is Nigeria's federally mandated national emergency number (NCC/NEMA),
 *   toll-free on every network, routing to police/fire/ambulance/NSCDC via the
 *   Emergency Communications Centres. As of the National Economic Council's
 *   2026 harmonisation decision it is the number every state is consolidating
 *   onto — so it is the correct default for every state, not a fallback of
 *   last resort.
 * - A state gets a STATE_OVERRIDES entry only when a second, state-run,
 *   medical-specific line is independently verifiable from an official state
 *   source (a .gov domain or the service's own official site) — not from a
 *   single aggregator blog. As of 2026-08-10 that bar is only met for Lagos
 *   (LASAMBUS/LASEMS — lasambus.org, lagosministryofhealth.org): 767 (toll-free
 *   state emergency line) and 123 (LASEMS/LASAMBUS/Ministry of Health hotline).
 * - Deliberately NOT populated with a distinct line for the other 35 states:
 *   no source found during the 2026-08-10 research pass met the same bar, and
 *   several aggregator sites either repeated the national number under a
 *   state's heading or listed a single hospital's private switchboard as if it
 *   were the state's emergency line. Presenting an unverified number in a
 *   hypertensive-crisis flow is worse than presenting none — 112 already
 *   reaches every one of them. Add a state here only after verifying the
 *   number directly against an official state government or agency source.
 */
export type EmergencyNumber = { label: string; number: string; tel: string };

const NATIONAL: EmergencyNumber[] = [
  { label: "National Emergency Line", number: "112", tel: "112" },
];

const STATE_OVERRIDES: Record<string, EmergencyNumber[]> = {
  Lagos: [
    { label: "National Emergency Line", number: "112", tel: "112" },
    { label: "Lagos State Emergency (toll-free)", number: "767", tel: "767" },
    { label: "LASEMS / LASAMBUS Ambulance", number: "123", tel: "123" },
  ],
};

/** All 37 canonical state values resolve to at least the national line — never undefined/blank. */
export function getEmergencyNumbers(state: string | null | undefined): EmergencyNumber[] {
  // Object.hasOwn, not a bare truthy index: a bare lookup also matches
  // Object.prototype members, so a state value of "toString" or "constructor"
  // returned a Function from a routine contractually guaranteed to return a
  // non-empty list of numbers. This is the emergency screen, where returning
  // something that is not a phone number is a real-harm outcome. The mobile
  // twin was fixed the same way; keep the two in step.
  if (state && Object.hasOwn(STATE_OVERRIDES, state)) return STATE_OVERRIDES[state];
  return NATIONAL;
}

// Dev-time completeness check: every canonical state must resolve to a non-empty list.
if (process.env.NODE_ENV !== "production") {
  for (const { value } of NIGERIAN_STATES) {
    if (getEmergencyNumbers(value).length === 0) {
      throw new Error(`nigeria-emergency-numbers: no entry resolves for state "${value}"`);
    }
  }
}

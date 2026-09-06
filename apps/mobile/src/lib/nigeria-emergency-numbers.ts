/**
 * Mirrors apps/web/src/lib/nigeria-emergency-numbers.ts — bundled in the
 * binary (not fetched) so it renders with zero signal. Getting one of these
 * wrong is a real-harm scenario, so keep this list exactly in lock-step with
 * the web source; only add a state override after independently verifying
 * the number against an official .gov/agency source, per that file's own
 * comment.
 */
export type EmergencyNumber = { label: string; number: string; tel: string };

const NATIONAL: EmergencyNumber[] = [{ label: "National Emergency Line", number: "112", tel: "112" }];

const STATE_OVERRIDES: Record<string, EmergencyNumber[]> = {
  Lagos: [
    { label: "National Emergency Line", number: "112", tel: "112" },
    { label: "Lagos State Emergency (toll-free)", number: "767", tel: "767" },
    { label: "LASEMS / LASAMBUS Ambulance", number: "123", tel: "123" },
  ],
};

/**
 * Every state resolves to at least the national line — never empty.
 *
 * `Object.hasOwn`, not a plain truthy index: a bare `STATE_OVERRIDES[state]`
 * also matches inherited Object.prototype members, so a state value of
 * "constructor" or "toString" returned a FUNCTION from a screen whose whole
 * contract is "never empty" — the emergency card would then render no number
 * at all. Unreachable through the canonical state list today, but this is the
 * one screen where a wrong or missing number is a real-harm outcome, so it
 * is closed rather than argued about. The same shape exists in the web copy
 * (apps/web/src/lib/nigeria-emergency-numbers.ts) and should be closed there
 * too; the NUMBERS remain in lock-step either way.
 */
export function getEmergencyNumbers(state: string | null | undefined): EmergencyNumber[] {
  if (state && Object.hasOwn(STATE_OVERRIDES, state)) return STATE_OVERRIDES[state];
  return NATIONAL;
}
